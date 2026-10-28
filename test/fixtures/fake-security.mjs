#!/usr/bin/env node
// A stand-in for macOS `security` (generic passwords only): items live in $FAKE_SECURITY_DB, every argv is appended to
// $FAKE_SECURITY_LOG so tests can check a secret never rode on a command line. Exit 44 = not found, like the real one.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const db = process.env.FAKE_SECURITY_DB;
const load = () => (existsSync(db) ? JSON.parse(readFileSync(db, 'utf8')) : {});
const save = (o) => writeFileSync(db, JSON.stringify(o));
if (process.env.FAKE_SECURITY_LOG) appendFileSync(process.env.FAKE_SECURITY_LOG, JSON.stringify(process.argv.slice(2)) + '\n');

/** -s service -a account [-w value] from a token list. */
function opts(words) {
  const o = {};
  for (let i = 0; i < words.length; i++) if (/^-[saw]$/.test(words[i])) o[words[i][1]] = words[++i];
  return o;
}
function run(cmd, words) {
  const items = load();
  const o = opts(words);
  const key = `${o.s}/${o.a}`;
  if (cmd === 'add-generic-password') {
    if (!words.includes('-U') && key in items) return 45;
    items[key] = o.w;
    save(items);
    return 0;
  }
  if (cmd === 'find-generic-password') {
    if (!(key in items)) return 44;
    process.stdout.write(items[key] + '\n');
    return 0;
  }
  if (cmd === 'delete-generic-password') {
    if (!(key in items)) return 44;
    delete items[key];
    save(items);
    return 0;
  }
  return 1;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === '-i') {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    let code = 0;
    for (const line of input.split('\n').filter(Boolean)) {
      const words = [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
      code = run(words[0], words.slice(1)) || code;
    }
    process.exit(code);
  });
} else process.exit(run(cmd, rest));
