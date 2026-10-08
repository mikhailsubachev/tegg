// Static checks of the repository's Claude Code configuration (black box, tools/qa/CONTRACT.md §4.5, §10):
// TS-HOOKS AC-3, TS-P AC-2, TS-I AC-3.
//
// These describe files that already exist before `verify` is implemented, so they pass at the red commit.
// They are kept apart from the other AC files so that `verify check-red` (CONTRACT §5.2: every testcase of an
// added file must fail by assertion) can judge those files; this file needs a `Red-First-Exempt:` trailer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readJsonFile } from './helpers.ts';

function settings(): any {
  return readJsonFile(path.join(REPO_ROOT, '.claude', 'settings.json'), 'project Claude Code settings');
}

// ---------------------------------------------------------------------------
// TS-HOOKS AC-3: permissions deny --no-verify
// ---------------------------------------------------------------------------

test('ts_hooks_ac3_permissions_deny_no_verify_commit_and_push', () => {
  const deny: unknown = settings()?.permissions?.deny;
  assert.ok(Array.isArray(deny), 'permissions.deny must be an array');
  for (const rule of ['Bash(git commit --no-verify:*)', 'Bash(git push --no-verify:*)']) {
    assert.ok((deny as string[]).includes(rule), `permissions.deny must contain ${rule}`);
  }
});

// ---------------------------------------------------------------------------
// TS-P AC-2: Claude Code permissions deny reading and editing test exports/
// ---------------------------------------------------------------------------

test('ts_p_ac2_permissions_deny_read_and_edit_of_test_exports', () => {
  const deny: unknown = settings()?.permissions?.deny;
  assert.ok(Array.isArray(deny), 'permissions.deny must be an array');
  for (const rule of ['Read(./test exports/**)', 'Edit(./test exports/**)']) {
    assert.ok((deny as string[]).includes(rule), `permissions.deny must contain ${rule}`);
  }
});

// ---------------------------------------------------------------------------
// TS-I AC-3: agent definitions
// ---------------------------------------------------------------------------

function agent(name: string): { front: Record<string, string>; body: string } {
  const p = path.join(REPO_ROOT, '.claude', 'agents', `${name}.md`);
  assert.ok(fs.existsSync(p), `${p} must exist`);
  const text = fs.readFileSync(p, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${p} must start with YAML frontmatter`);
  const front: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { front, body: m[2] };
}

const NEGATION = /\b(never|not|don't|do not|must not|forbidden)\b/i;

test('ts_i_ac3_four_agent_roles_with_name_and_description', () => {
  for (const name of ['ac-author', 'test-author', 'qa-reviewer', 'explorer']) {
    const { front } = agent(name);
    assert.equal(front.name, name, `${name}.md: name`);
    assert.ok((front.description ?? '').length > 0, `${name}.md: description must be non-empty`);
  }
});

test('ts_i_ac3_qa_reviewer_has_read_only_tools', () => {
  const tools = (agent('qa-reviewer').front.tools ?? '').split(',').map((s) => s.trim()).filter(Boolean).sort();
  assert.deepEqual(tools, ['Glob', 'Grep', 'Read']);
});

test('ts_i_ac3_test_author_forbids_reading_implementation', () => {
  const lines = agent('test-author').body.split('\n').filter((l) => /implementation/i.test(l) && /\bread/i.test(l) && NEGATION.test(l));
  assert.ok(lines.length > 0, 'test-author.md body must forbid reading the implementation under test');
});

test('ts_i_ac3_explorer_forbids_opening_test_exports', () => {
  const lines = agent('explorer').body.split('\n').filter((l) => l.includes('test exports/') && NEGATION.test(l));
  assert.ok(lines.length > 0, 'explorer.md body must forbid opening test exports/');
});
