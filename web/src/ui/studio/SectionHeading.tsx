import type { ReactNode } from 'react';
import './parts.css';

export function SectionHeading(props: { id?: string; title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="sl-section-heading">
      <h2 id={props.id}>{props.title}</h2>
      {props.count !== undefined ? <span className="sl-count">{props.count}</span> : null}
      {props.action ? <div className="sl-heading-action">{props.action}</div> : null}
    </div>
  );
}
