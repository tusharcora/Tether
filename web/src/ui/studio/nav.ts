import { Braces, Code, House, ListChecks, Network, Users, Workflow, Zap, type LucideIcon } from 'lucide-react';
import { TAB_LABEL, type Screen } from '../../hooks';

/** The screens in nav order. `long`: the sidebar's fuller label where the short one is for tight spaces. */
export const NAV: { id: Screen; label: string; long?: string; Icon: LucideIcon }[] = [
  { id: 'home', label: TAB_LABEL.home, Icon: House },
  { id: 'runs', label: TAB_LABEL.runs, Icon: ListChecks },
  { id: 'code', label: TAB_LABEL.code, Icon: Code },
  { id: 'builder', label: TAB_LABEL.builder, Icon: Workflow },
  { id: 'crew', label: TAB_LABEL.crew, Icon: Users },
  { id: 'api', label: TAB_LABEL.api, long: 'API client', Icon: Braces },
  { id: 'graph', label: TAB_LABEL.graph, Icon: Network },
  { id: 'triggers', label: TAB_LABEL.triggers, Icon: Zap },
];
