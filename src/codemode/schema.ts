/** JSON Schema → TypeScript, for `codemode.describe()` (types are for the model to read; nothing is checked). */
import type { JsonSchema, Method } from './types.js';

const IDENT = /^[A-Za-z_$][\w$]*$/;
const MAX_DEPTH = 6;
const lit = (v: unknown) => JSON.stringify(v);
const comment = (text: unknown, pad: string) => (typeof text === 'string' && text.trim() ? `${pad}/** ${text.trim().replace(/\*\//g, '* /').replace(/\s*\n\s*/g, ' ')} */\n` : '');

/** The TypeScript type a JSON Schema describes (best effort: unknown keywords give `unknown`). */
export function jsonSchemaToTs(schema: unknown, depth = 0, indent = ''): string {
  if (!schema || typeof schema !== 'object' || depth > MAX_DEPTH) return 'unknown';
  const s = schema as JsonSchema;
  if ('const' in s) return lit(s.const);
  if (Array.isArray(s.enum)) return s.enum.map(lit).join(' | ') || 'never';
  const union = (list: unknown, sep: string) => (Array.isArray(list) && list.length ? list.map((x) => jsonSchemaToTs(x, depth + 1, indent)).join(sep) : undefined);
  const any = union(s.anyOf, ' | ') ?? union(s.oneOf, ' | ');
  if (any) return any;
  const all = union(s.allOf, ' & ');
  if (all) return all;
  if (Array.isArray(s.type)) return s.type.map((t) => jsonSchemaToTs({ ...s, type: t }, depth + 1, indent)).join(' | ');
  switch (s.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const item = jsonSchemaToTs(s.items, depth + 1, indent);
      return /[|&\s]/.test(item) ? `Array<${item}>` : `${item}[]`;
    }
    case 'object':
    case undefined: {
      const props = s.properties && typeof s.properties === 'object' ? (s.properties as Record<string, JsonSchema>) : undefined;
      if (!props) {
        if (s.type === undefined) return 'unknown';
        const extra = s.additionalProperties && typeof s.additionalProperties === 'object' ? jsonSchemaToTs(s.additionalProperties, depth + 1, indent) : 'unknown';
        return `Record<string, ${extra}>`;
      }
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const inner = `${indent}  `;
      const lines = Object.entries(props).map(([k, v]) => `${comment(v?.description, inner)}${inner}${IDENT.test(k) ? k : lit(k)}${required.has(k) ? '' : '?'}: ${jsonSchemaToTs(v, depth + 1, inner)};`);
      return lines.length ? `{\n${lines.join('\n')}\n${indent}}` : '{}';
    }
    default:
      return 'unknown';
  }
}

/** A method's declaration as describe() shows it: its doc comment and `ns.name(params): Promise<returns>`. */
export function signature(ns: string, m: Method): string {
  const params = (m.params ?? []).map((p) => `${p.name}${p.optional ? '?' : ''}: ${jsonSchemaToTs(p.schema)}`).join(', ');
  const doc = [m.summary, m.doc].filter(Boolean).join('\n * ');
  return `/**\n * ${doc}\n */\n${ns}.${m.name}(${params}): Promise<${m.returns ?? 'unknown'}>;`;
}
