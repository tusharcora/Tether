import type { ReactNode } from 'react';
import { EmptyState as ArcEmptyState } from '../../components/kept/empty-state/empty-state';
import './parts.css';

/** Arc's empty state with Studio spacing: say what is empty and offer one useful action. */
export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  return <ArcEmptyState className="sl-empty" title={props.title} description={props.description} action={props.action} />;
}
