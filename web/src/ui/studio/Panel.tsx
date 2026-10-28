import { useId, type ReactNode } from 'react';
import { Card } from '../../components/beui/motion/card';
import { cn } from '../cn';
import { SectionHeading } from './SectionHeading';
import './parts.css';

/** A bordered surface (beui's Card on Studio tokens). With a title it is a region named by its heading. */
export function Panel(props: { title?: string; count?: number; action?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card role="region" className={cn('sl-panel gap-0 rounded-(--radius-panel) px-4 py-3.5', props.className)} aria-labelledby={props.title ? id : undefined}>
      {props.title ? <SectionHeading id={id} title={props.title} count={props.count} action={props.action} /> : null}
      {props.children}
    </Card>
  );
}
