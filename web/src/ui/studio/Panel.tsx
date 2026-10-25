import { useId, type ReactNode } from 'react';
import { cn } from '../cn';
import { SectionHeading } from './SectionHeading';
import './parts.css';

/** A bordered surface. With a title it is a region named by its heading. */
export function Panel(props: { title?: string; count?: number; action?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={cn('sl-panel', props.className)} aria-labelledby={props.title ? id : undefined}>
      {props.title ? <SectionHeading id={id} title={props.title} count={props.count} action={props.action} /> : null}
      {props.children}
    </section>
  );
}
