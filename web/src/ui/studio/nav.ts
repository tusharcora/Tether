import { ArrowLeftRight, Code, House, Inbox, Play, Users, Waypoints, Workflow, Zap, type LucideIcon } from 'lucide-react';
import { TAB_LABEL, type Screen } from '../../hooks';

/**
 * The screens in nav order, with the sidebar's line icons (spec §2) and their Linear-style `G` + letter shortcut.
 * `long`: the sidebar's fuller label where the short one is for tight spaces. `top`: in the sidebar's top items, not Workspace.
 */
export const NAV: { id: Screen; label: string; long?: string; Icon: LucideIcon; go: string; top?: true }[] = [
  { id: 'home', label: TAB_LABEL.home, Icon: House, go: 'h', top: true },
  { id: 'inbox', label: TAB_LABEL.inbox, Icon: Inbox, go: 'i', top: true },
  { id: 'runs', label: TAB_LABEL.runs, Icon: Play, go: 'u', top: true },
  { id: 'code', label: TAB_LABEL.code, Icon: Code, go: 'c' },
  { id: 'builder', label: TAB_LABEL.builder, Icon: Workflow, go: 'b' },
  { id: 'crew', label: TAB_LABEL.crew, Icon: Users, go: 'r' },
  { id: 'api', label: TAB_LABEL.api, long: 'API client', Icon: ArrowLeftRight, go: 'a' },
  { id: 'graph', label: TAB_LABEL.graph, Icon: Waypoints, go: 'g' },
  { id: 'triggers', label: TAB_LABEL.triggers, Icon: Zap, go: 't' },
];

/** `G x` as shown on hover and in ⌘K. */
export const goHint = (s: Screen): string => `G ${(NAV.find((n) => n.id === s)?.go ?? '').toUpperCase()}`;
