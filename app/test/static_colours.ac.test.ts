// MS3 slice 3A static rule (L0): FR-UX-05 AC-2, no colour literals in app/ui/src outside the theme token module
// (and the logo asset). docs/acceptance/app-shell.md, docs/contracts/ms3-shell.md §3.5.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '../ui/src');
const TOKENS = 'theme/tokens.ts';

function files(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.test(name)) out.push(p);
  }
  return out.sort();
}

const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const COLOR_PROP = String.raw`(?:color|background(?:-color)?|backgroundColor|border(?:-(?:top|right|bottom|left))?(?:-color)?|border(?:Top|Right|Bottom|Left)?Color|outline(?:-color)?|outlineColor|fill|stroke|box-shadow|boxShadow|text-shadow|textShadow|caret-color|caretColor|accent-color|accentColor|text-decoration-color|textDecorationColor|column-rule-color)`;
const COLOR_RULES: [string, RegExp][] = [
  ['hex colour', /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/],
  ['rgb()/rgba()', /\brgba?\s*\(/i],
  ['hsl()/hsla()', /\bhsla?\s*\(/i],
  ['named colour', new RegExp(`${COLOR_PROP}\\s*:\\s*['"]?[^;'"\\n]*?\\b(?:${NAMED.join('|')})\\b`, 'i')],
];

test('fr_ux_05_ac2_no_colour_literals_outside_theme_tokens', () => {
  const offenders: string[] = [];
  for (const f of files(SRC, /\.(tsx?|jsx?|css|html|svg)$/)) {
    const rel = relative(SRC, f);
    if (rel === TOKENS || /(^|\/)logo[^/]*\.svg$/.test(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const [what, re] of COLOR_RULES) if (re.test(line)) offenders.push(`${rel}:${i + 1}: ${what}`);
    });
  }
  assert.deepEqual(offenders, [], 'colour literals outside theme/tokens.ts (FR-UX-05 AC-2)');
});
