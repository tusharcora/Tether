import type { JSX } from 'solid-js';

export const CREW: Record<string, { name: string; title: string; hue: string }> = {
  orchestrator: { name: 'Maestro', title: 'orchestrator', hue: '#9b7bff' },
  planner: { name: 'Scout', title: 'planner', hue: '#5b9dff' },
  architect: { name: 'Brick', title: 'architect', hue: '#38c5d6' },
  coder: { name: 'Bolt', title: 'coder', hue: '#3fb97c' },
  tester: { name: 'Probe', title: 'tester', hue: '#e3ab3a' },
  reviewer: { name: 'Lens', title: 'reviewer', hue: '#e46fa8' },
  approval: { name: 'Gate', title: 'approver', hue: '#9aa6b8' },
};

/** Same mapping as the terminal's crewFor: which bot runs a given node. */
export function crewFor(node: { kind: string; role?: string }): string {
  if (node.kind === 'gate') return 'tester';
  if (node.kind === 'approval') return 'approval';
  const r = (node.role ?? '').toLowerCase();
  if (r in CREW) return r;
  if (/test|qa/.test(r)) return 'tester';
  if (/review|audit/.test(r)) return 'reviewer';
  if (/arch|design/.test(r)) return 'architect';
  if (/plan|research|spec/.test(r)) return 'planner';
  return 'coder';
}

/** Pebble style: one flat shape, two eyes, one mark. */
export function Pebble(props: { role: string; size?: number }): JSX.Element {
  const c = () => CREW[props.role] ?? CREW.coder!;
  const mark = () => {
    switch (props.role) {
      case 'orchestrator': return <path d="M14 8l2 3 2-3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />;
      case 'planner': return <circle cx="16" cy="9" r="1.6" fill="#fff" />;
      case 'architect': return <rect x="14" y="7.4" width="4" height="3" fill="#fff" rx=".5" />;
      case 'tester': return <path d="M14 9.4l1.6 1.6 2.8-3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />;
      case 'reviewer': return <circle cx="16" cy="9" r="2" fill="none" stroke="#fff" stroke-width="1.4" />;
      case 'approval': return <path d="M13.5 10.5V8a2.5 2.5 0 015 0v2.5" fill="none" stroke="#fff" stroke-width="1.5" />;
      default: return <path d="M14.5 7.5l-2 2 2 2M17.5 7.5l2 2-2 2" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />;
    }
  };
  return (
    <svg viewBox="0 0 32 32" width={props.size ?? 40} height={props.size ?? 40} role="img" aria-label={c().name}>
      <path d="M16 3c7 0 12.5 5 12.5 12.5 0 7.6-5 13.5-12.5 13.5S3.5 23.1 3.5 15.5C3.5 8 9 3 16 3z" fill={c().hue} />
      <circle cx="11.5" cy="18.5" r="1.9" fill="#0d1117" />
      <circle cx="20.5" cy="18.5" r="1.9" fill="#0d1117" />
      {mark()}
    </svg>
  );
}
