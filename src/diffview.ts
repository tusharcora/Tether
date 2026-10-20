/** Parse and render a unified diff for the terminal: line numbers, syntax colour, hunk and file jumps, split view. */
import { bgCode, caps, clip, cyan, dim, faint, green, paint, pal, red, strip, vlen, type RGB } from './ui.js';

export interface DRow {
  k: 'ctx' | 'add' | 'del' | 'hunk' | 'file' | 'meta';
  o?: number;
  n?: number;
  text: string;
}
export interface DiffFile {
  path: string;
  add: number;
  del: number;
  row: number;
}
export interface ParsedDiff {
  rows: DRow[];
  files: DiffFile[];
  hunks: number[];
  add: number;
  del: number;
}

export function parseDiff(text: string): ParsedDiff {
  const rows: DRow[] = [];
  const files: DiffFile[] = [];
  const hunks: number[] = [];
  let o = 0, n = 0, cur: DiffFile | undefined, inHunk = false;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    let m: RegExpExecArray | null;
    if (raw.startsWith('diff --git ')) {
      m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      cur = { path: m ? m[2]! : raw.slice(11), add: 0, del: 0, row: rows.length };
      files.push(cur);
      rows.push({ k: 'file', text: cur.path });
      inHunk = false;
    } else if (!inHunk && /^(index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename )/.test(raw)) {
      if (/^(new file|deleted file|rename )/.test(raw)) rows.push({ k: 'meta', text: raw });
    } else if ((m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s?(.*)$/.exec(raw))) {
      o = +m[1]!;
      n = +m[2]!;
      inHunk = true;
      hunks.push(rows.length);
      rows.push({ k: 'hunk', text: `@@ ${m[3] ?? ''}`.trim() === '@@' ? `@@ line ${n}` : `@@ ${m[3]}` });
    } else if (inHunk && raw.startsWith('+')) {
      rows.push({ k: 'add', n: n++, text: raw.slice(1) });
      if (cur) cur.add++;
    } else if (inHunk && raw.startsWith('-')) {
      rows.push({ k: 'del', o: o++, text: raw.slice(1) });
      if (cur) cur.del++;
    } else if (inHunk && raw.startsWith(' ')) {
      rows.push({ k: 'ctx', o: o++, n: n++, text: raw.slice(1) });
    } else if (raw.startsWith('Binary files')) {
      rows.push({ k: 'meta', text: raw });
    } else if (raw.startsWith('\\')) {
      rows.push({ k: 'meta', text: raw });
    }
  }
  return { rows, files, hunks, add: files.reduce((t, f) => t + f.add, 0), del: files.reduce((t, f) => t + f.del, 0) };
}

// ---------- syntax colour ----------
const KW = /\b(?:const|let|var|function|return|if|else|for|while|import|from|export|default|class|extends|new|throw|try|catch|finally|async|await|interface|type|enum|public|private|static|def|elif|None|True|False|self|lambda|fn|pub|use|impl|struct|func|package|null|undefined|true|false)\b/;
const TOKEN = new RegExp(`(\\/\\/.*$|#.*$)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)|(${KW.source})|(\\b\\d[\\d_.]*\\b)`, 'g');

/** Colour one line of code. Operates on plain text, so slicing before calling never cuts an escape sequence. */
export function highlight(code: string): string {
  if (!caps.level) return code;
  let out = '', i = 0, m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code))) {
    if (m[0] === '') { TOKEN.lastIndex++; continue; }
    out += code.slice(i, m.index);
    out += m[1] ? faint(m[0]) : m[2] ? green(m[0]) : m[3] ? paint(pal.violet, m[0]) : paint(pal.amber, m[0]);
    i = m.index + m[0].length;
  }
  return out + code.slice(i);
}

const TINT_ADD: RGB = [18, 46, 30];
const TINT_DEL: RGB = [58, 24, 28];
const tint = (c: RGB, s: string) => (caps.level ? `${bgCode(c)}${s}\x1b[0m` : s);
const fit = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - vlen(s)));
const tabs = (s: string) => strip(s).replace(/\t/g, '  ');

function sign(r: DRow) {
  return r.k === 'add' ? green('+') : r.k === 'del' ? red('−') : ' ';
}

function unifiedRow(r: DRow, w: number, numW: number): string {
  if (r.k === 'file') return cyan(`▎${r.text}`);
  if (r.k === 'meta') return dim(r.text);
  if (r.k === 'hunk') return paint(pal.violet, `${' '.repeat(numW * 2 + 2)}${r.text}`);
  const num = (v?: number) => dim((v === undefined ? '' : String(v)).padStart(numW));
  const body = highlight(tabs(r.text).slice(0, Math.max(10, w - numW * 2 - 5)));
  const line = `${num(r.o)} ${num(r.n)} ${sign(r)} ${body}`;
  return r.k === 'add' ? tint(TINT_ADD, fit(line, w)) : r.k === 'del' ? tint(TINT_DEL, fit(line, w)) : line;
}

/** Every row as one line, ready to scroll. */
export function renderUnified(p: ParsedDiff, width: number): string[] {
  const numW = String(Math.max(1, ...p.rows.map((r) => Math.max(r.o ?? 0, r.n ?? 0)))).length;
  return p.rows.map((r) => unifiedRow(r, width, numW));
}

/** Old on the left, new on the right; changed runs are paired line by line. */
export function renderSplit(p: ParsedDiff, width: number): string[] {
  const half = Math.floor((width - 3) / 2);
  const numW = String(Math.max(1, ...p.rows.map((r) => Math.max(r.o ?? 0, r.n ?? 0)))).length;
  const side = (r: DRow | undefined, left: boolean): string => {
    if (!r) return ' '.repeat(half);
    const v = left ? r.o : r.n;
    const body = highlight(tabs(r.text).slice(0, Math.max(4, half - numW - 3)));
    const line = `${dim((v === undefined ? '' : String(v)).padStart(numW))} ${sign(r)} ${body}`;
    const padded = fit(line, half);
    return r.k === 'add' ? tint(TINT_ADD, padded) : r.k === 'del' ? tint(TINT_DEL, padded) : padded;
  };
  const out: string[] = [];
  const rows = p.rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.k === 'file') out.push(cyan(`▎${r.text}`));
    else if (r.k === 'meta') out.push(dim(r.text));
    else if (r.k === 'hunk') out.push(paint(pal.violet, r.text));
    else if (r.k === 'ctx') out.push(`${side(r, true)} ${faint('│')} ${side(r, false)}`);
    else {
      const dels: DRow[] = [], adds: DRow[] = [];
      while (rows[i]?.k === 'del') dels.push(rows[i++]!);
      while (rows[i]?.k === 'add') adds.push(rows[i++]!);
      i--;
      for (let j = 0; j < Math.max(dels.length, adds.length); j++) out.push(`${side(dels[j], true)} ${faint('│')} ${side(adds[j], false)}`);
    }
  }
  return out;
}

/** Indices into the rendered lines where each hunk / file starts (unified view; split keeps one line per row except paired runs). */
export function jumpPoints(p: ParsedDiff, split: boolean): { hunks: number[]; files: number[] } {
  if (!split) return { hunks: p.hunks, files: p.files.map((f) => f.row) };
  // In split view paired del/add runs collapse, so recompute positions by walking the same way renderSplit does.
  const hunks: number[] = [], files: number[] = [];
  let line = 0;
  const rows = p.rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.k === 'file') files.push(line++);
    else if (r.k === 'hunk') hunks.push(line++);
    else if (r.k === 'del' || r.k === 'add') {
      let d = 0, a = 0;
      while (rows[i]?.k === 'del') (d++, i++);
      while (rows[i]?.k === 'add') (a++, i++);
      i--;
      line += Math.max(d, a);
    } else line++;
  }
  return { hunks, files };
}

export const summary = (p: ParsedDiff) => `${p.files.length} file${p.files.length === 1 ? '' : 's'}  ${green('+' + p.add)} ${red('−' + p.del)}`;
export { clip };
