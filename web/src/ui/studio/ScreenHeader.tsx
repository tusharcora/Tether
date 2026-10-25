import type { ReactNode } from 'react';
import './parts.css';

/** The top of a screen: a mono meta line, the title (the page's h1), a summary and right-aligned actions. */
export function ScreenHeader(props: { meta?: ReactNode; title: string; summary?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sl-screen-header">
      <div>
        {props.meta ? <p className="sl-meta">{props.meta}</p> : null}
        <h1>{props.title}</h1>
        {props.summary ? <p className="sl-summary">{props.summary}</p> : null}
      </div>
      {props.actions ? <div className="sl-actions">{props.actions}</div> : null}
    </header>
  );
}
