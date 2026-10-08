// `./verify` command line (D-60, tools/qa/CONTRACT.md).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type Gate } from './config.ts';
import { checkRed, protectedChanges } from './checks.ts';
import { writeReport } from './coverage.ts';
import { nightlyWarning, runCommitGate, runTreeGate } from './gates.ts';
import { AC_TEST_CHANGE_TRAILER, UsageError, git, gitTry, hasTrailer, parseNameStatusZ, repoRoot, treeOf } from './proc.ts';

const USAGE = `Usage: ./verify <command> [options]

Gates (docs/test-strategy.md §8):
  commit                          G0: privacy check on staged files, commit-level steps
  push [--commit <rev>] [--range <a>..<b>]
                                  G1: checks + steps in a fresh worktree; records .verify/last-pass
  nightly                         G2: push + nightly steps; reports failures in qa/nightly/
  milestone --milestone <MSn>     G3: nightly + milestone steps + milestone AC check
  release                         G4: everything + AC check for all milestones

Tools:
  coverage [--results <dir>]      write qa/coverage/ac-matrix.md
  check-red <commit>              AC tests added by <commit> must fail by assertion (TS-I AC-2)
  counts-only [file]              real-export output must contain counts only (TS-P AC-3)
  review-prep [--base <rev>]      write .verify/review/ for the QA reviewer agent
  install                         use .githooks/ as git hooks
  install-nightly [--dry-run]     install the launchd job running the nightly gate
  hook pre-push|commit-msg|claude-pre-tool   called by git / Claude Code hooks

Contract: tools/qa/CONTRACT.md`;

function readStdin(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`verify: ${name} needs a value`);
  return v;
}

function warnings(root: string): void {
  if (gitTry(root, ['config', '--get', 'core.hooksPath']).stdout.trim() !== '.githooks') {
    process.stderr.write('verify: warning: git hooks not installed; run ./verify install\n');
  }
  const w = nightlyWarning(root);
  if (w) process.stderr.write(w + '\n');
}

function lastPass(root: string): string {
  try {
    return fs.readFileSync(path.join(root, '.verify', 'last-pass'), 'utf8').trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Hooks (CONTRACT §4)
// ---------------------------------------------------------------------------

const ZERO = /^0+$/;

function hookPrePush(root: string): number {
  const cfg = loadConfig(root);
  let failed = false;
  for (const line of readStdin().split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [, localSha, , remoteSha] = parts;
    if (ZERO.test(localSha)) continue;
    if (treeOf(root, localSha) === lastPass(root)) {
      console.log(`verify: ${localSha.slice(0, 10)} already passed ./verify push; skipping`);
      continue;
    }
    const s = runTreeGate(root, cfg, 'push', { commit: localSha, range: ZERO.test(remoteSha) ? undefined : `${remoteSha}..${localSha}` });
    if (s.result !== 'pass') failed = true;
  }
  return failed ? 1 : 0;
}

function hookCommitMsg(root: string, file: string | undefined): number {
  if (!file) throw new UsageError('verify hook commit-msg: message file required');
  const cfg = loadConfig(root);
  const changes = parseNameStatusZ(git(root, ['diff', '--cached', '--name-status', '-M', '-z']));
  const files = protectedChanges(cfg, changes);
  if (files.length === 0) return 0;
  const msg = fs.readFileSync(path.resolve(file), 'utf8');
  if (hasTrailer(msg, AC_TEST_CHANGE_TRAILER)) return 0;
  process.stderr.write(
    `verify: this commit modifies, deletes or renames existing AC test file(s):\n${files.map((f) => `    ${f}`).join('\n')}\n` +
      `Changing AC tests needs owner approval: add the trailer "AC-Test-Change: <reason>; approved-by: owner" (TS-I3, D-61).\n`,
  );
  return 1;
}

/** Claude Code PreToolUse hook: block git push / gh pr merge until ./verify push passed for HEAD's tree. */
function hookClaudePreTool(): number {
  try {
    const input = JSON.parse(readStdin());
    if (input?.tool_name !== 'Bash') return 0;
    const command = String(input?.tool_input?.command ?? '');
    if (!/\bgit\s+push\b/.test(command) && !/\bgh\s+pr\s+merge\b/.test(command)) return 0;
    const root = repoRoot(typeof input.cwd === 'string' && fs.existsSync(input.cwd) ? input.cwd : process.cwd());
    if (!fs.existsSync(path.join(root, 'qa.config.json'))) return 0;
    const head = gitTry(root, ['rev-parse', 'HEAD^{tree}']);
    if (head.status !== 0) return 0;
    if (lastPass(root) === head.stdout.trim()) return 0;
    process.stderr.write(
      'Blocked: ./verify push has not passed for the current HEAD tree. Run ./verify push first (D-60, TS-HOOKS AC-2); if it fails, fix the problems, commit, and run it again.\n',
    );
    return 2;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// counts-only (TS-P AC-3, CONTRACT §6.1)
// ---------------------------------------------------------------------------

export function isCountsOnly(line: string): boolean {
  const rest = line
    .replace(/"[A-Za-z0-9_-]+"\s*:/g, '')
    .replace(/[A-Za-z][A-Za-z0-9 _-]*:/g, '');
  return /^[0-9\s{}[\],.:%/-]*$/.test(rest);
}

function countsOnly(file: string | undefined): number {
  const text = file ? fs.readFileSync(file, 'utf8') : readStdin();
  const bad: number[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() && !isCountsOnly(line)) bad.push(i + 1);
  });
  if (bad.length === 0) return 0;
  process.stderr.write(`verify counts-only: lines with more than counts (content not shown): ${bad.join(', ')}\n`);
  return 1;
}

// ---------------------------------------------------------------------------
// install-nightly (TS-G2 AC-1, CONTRACT §8.2)
// ---------------------------------------------------------------------------

const LABEL = 'com.tegg.verify-nightly';

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plist(root: string): string {
  const pathVar = [path.dirname(process.execPath), path.join(os.homedir(), '.cargo', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const args = ['/usr/bin/caffeinate', '-i', path.join(root, 'verify'), 'nightly'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(pathVar)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(path.join(root, '.verify', 'nightly.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(root, '.verify', 'nightly.err.log'))}</string>
</dict>
</plist>
`;
}

function installNightly(root: string, dryRun: boolean): number {
  const content = plist(root);
  if (dryRun) {
    process.stdout.write(content);
    return 0;
  }
  const file = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  fs.writeFileSync(file, content);
  const domain = `gui/${process.getuid?.() ?? ''}`;
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', domain, file], { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`verify: launchctl bootstrap failed: ${r.stderr}\n`);
    return 1;
  }
  console.log(`verify: installed ${file}; the nightly gate runs at 02:30 (or at the next wake)`);
  return 0;
}

// ---------------------------------------------------------------------------
// review-prep (CONTRACT §11)
// ---------------------------------------------------------------------------

function reviewPrep(root: string, base: string): number {
  const mergeBase = git(root, ['merge-base', 'HEAD', base]).trim();
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const tree = treeOf(root, 'HEAD');
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const dir = path.join(root, '.verify', 'review');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'diff.patch'), git(root, ['diff', `${mergeBase}..HEAD`]));
  let push = 'missing';
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, '.verify', 'last-push.json'), 'utf8'));
    push = `${s.result} (tree ${s.tree}, ${s.tree === tree ? 'matches HEAD' : 'does NOT match HEAD'}, ${s.startedAt})`;
  } catch {
    // no push run yet
  }
  const log = git(root, ['log', '--format=%h %s', `${mergeBase}..HEAD`]);
  fs.writeFileSync(
    path.join(dir, 'context.md'),
    `# Review context\n\n- Branch: ${branch}\n- Base: ${base} (merge-base ${mergeBase})\n- Head: ${head}\n- Head tree: ${tree}\n- Last ./verify push: ${push}\n- Last-pass tree: ${lastPass(root) || 'none'}\n\n## Commits\n\n${log}`,
  );
  console.log(`verify: wrote ${path.relative(root, dir)}/diff.patch and context.md`);
  return 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  const [cmd, ...args] = argv;
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return cmd === undefined ? 2 : 0;
  }
  if (cmd === 'hook' && args[0] === 'claude-pre-tool') return hookClaudePreTool();
  if (cmd === 'counts-only') return countsOnly(args[0]);

  const root = repoRoot(process.cwd());
  if (cmd === 'install-nightly') {
    const dry = args.includes('--dry-run');
    if (!dry) warnings(root);
    return installNightly(root, dry);
  }
  warnings(root);
  if (cmd === 'install') {
    git(root, ['config', 'core.hooksPath', '.githooks']);
    console.log('verify: git hooks installed (core.hooksPath = .githooks)');
    return 0;
  }

  const cfg = loadConfig(root);
  switch (cmd) {
    case 'commit':
      return runCommitGate(root, cfg).result === 'pass' ? 0 : 1;
    case 'push':
    case 'nightly':
    case 'release': {
      const s = runTreeGate(root, cfg, cmd as Gate, { commit: option(args, '--commit'), range: option(args, '--range') });
      return s.result === 'pass' ? 0 : 1;
    }
    case 'milestone': {
      const ms = option(args, '--milestone');
      if (!ms) throw new UsageError('verify milestone: --milestone <MSn> is required');
      return runTreeGate(root, cfg, 'milestone', { milestone: ms }).result === 'pass' ? 0 : 1;
    }
    case 'coverage': {
      const results = option(args, '--results') ?? path.join(root, '.verify', 'last-results');
      console.log(`verify: wrote ${path.relative(root, writeReport(root, path.resolve(results)))}`);
      return 0;
    }
    case 'check-red': {
      if (!args[0]) throw new UsageError('verify check-red: <commit> required');
      const sha = gitTry(root, ['rev-parse', '--verify', '--quiet', `${args[0]}^{commit}`]);
      if (sha.status !== 0) throw new UsageError(`verify check-red: unknown commit ${args[0]}`);
      const r = checkRed(root, cfg, sha.stdout.trim());
      for (const m of r.messages) console.log(`✗ ${m}`);
      console.log(`verify check-red: ${r.ok ? 'PASS (all added AC tests fail by assertion)' : 'FAIL'}`);
      return r.ok ? 0 : 1;
    }
    case 'review-prep':
      return reviewPrep(root, option(args, '--base') ?? 'main');
    case 'hook':
      if (args[0] === 'pre-push') return hookPrePush(root);
      if (args[0] === 'commit-msg') return hookCommitMsg(root, args[1]);
      throw new UsageError(`verify: unknown hook ${args[0] ?? ''}`);
    default:
      throw new UsageError(`verify: unknown command "${cmd}"\n\n${USAGE}`);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UsageError) {
    process.stderr.write(e.message + '\n');
    process.exitCode = 2;
  } else {
    process.stderr.write(`verify: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
