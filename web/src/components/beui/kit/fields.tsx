import { forwardRef, useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input as BeuiInput } from '../motion/input';
import { Select as BeuiSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../motion/select';
import { RangeSlider } from '../motion/range-slider';
import { BouncyAccordion } from '../motion/bouncy-accordion';
import { Checkbox } from '../motion/checkbox';
import { Switch as BeuiSwitch } from '../motion/switch';
import { cn } from '../lib/utils';

/*
 * Tether's form controls over beui's primitives, on Studio tokens. Props stay close to what the screens already pass
 * (a visible label, onChange with the event, Radix-style onValueChange) so a screen swaps by import path.
 */

export { Checkbox };

const FIELD = 'h-11 rounded-lg border-border-strong bg-card ring-0 focus-within:border-foreground hover:border-foreground/60';
const FIELD_INPUT = 'text-sm';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'defaultValue'> {
  label: string;
  description?: string;
  error?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** A labelled text field: border colour answers focus, an error shakes once and speaks as an alert, the hint sits underneath. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, description, error, onChange, id, className, value, defaultValue, 'aria-describedby': describedBy, ...rest }, ref) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = description ? `${fieldId}-description` : undefined;
  return (
    <div className={cn('min-w-0', className)}>
      <BeuiInput
        {...rest}
        ref={ref}
        id={fieldId}
        label={label}
        error={error}
        value={value === undefined ? undefined : String(value)}
        defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(' ') || undefined}
        onChange={(_value, event) => onChange?.(event)}
        classNames={{ field: FIELD, input: FIELD_INPUT, label: 'px-0' }}
      />
      {description ? <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
});

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value' | 'defaultValue'> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}

/** A search box: the label names it for assistive tech and stays out of the way visually. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ label, value, onValueChange, id, className, ...rest }, ref) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={fieldId} className="sr-only">{label}</label>
      <BeuiInput {...rest} ref={ref} id={fieldId} type="search" value={value} onChange={onValueChange} leftIcon={<Search aria-hidden="true" />} classNames={{ field: cn(FIELD, 'h-9'), input: FIELD_INPUT }} />
    </div>
  );
});

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps {
  label: string;
  description?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}

/** A labelled single choice: the panel unfolds out of the trigger; arrows, Home/End and typeahead move through the options. */
export function Select({ label, description, placeholder = 'Select an option', id, className, options, value, defaultValue, onValueChange, disabled }: SelectProps) {
  const auto = useId();
  const labelId = `${id ?? auto}-label`;
  const hintId = description ? `${id ?? auto}-description` : undefined;
  return (
    <div className={cn('min-w-0', className)}>
      <span id={labelId} className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      <BeuiSelect value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger aria-labelledby={labelId} aria-describedby={hintId} className="h-11 rounded-lg border-border bg-card hover:border-border-strong">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
        </SelectContent>
      </BeuiSelect>
      {description ? <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/** A labelled on/off switch (role="switch"); ink when on. */
export function Switch({ 'aria-label': ariaLabel, id: _id, ...rest }: SwitchProps) {
  return <BeuiSwitch {...rest} ariaLabel={ariaLabel} />;
}

export interface SliderProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

/** A labelled slider with its value read out beside the label. Arrow keys step; the thumb announces the formatted value. */
export function Slider({ label, value, onValueChange, min = 0, max = 100, step = 1, format, disabled, className }: SliderProps) {
  const shown = format ? format(value) : String(value);
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm"><span className="font-medium text-foreground">{label}</span><span className="tabular-nums text-muted-foreground">{shown}</span></div>
      <RangeSlider value={value} onValueChange={onValueChange} min={min} max={max} step={step} showTicks={false} disabled={disabled} aria-label={label} formatValueText={format} />
    </div>
  );
}

export interface AccordionItem { title: string; content: ReactNode }
/** Single-open disclosure rows with a weighted spring; the first row starts open unless `defaultOpen` says otherwise. */
export function Accordion({ items, defaultOpen = 0 }: { items: AccordionItem[]; defaultOpen?: number; size?: 'md' | 'lg' }) {
  return <BouncyAccordion collapsible defaultValue={items[defaultOpen] ? `item-${defaultOpen}` : null} items={items.map((it, i) => ({ id: `item-${i}`, title: it.title, description: it.content }))} />;
}
