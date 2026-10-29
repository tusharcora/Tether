// assistant-ui element (github.com/assistant-ui/assistant-ui, MIT): the exports Tether uses (slash commands, @mentions and
// their menu), verbatim but for import paths.
"use client";

import {
  forwardRef,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "../../beui/lib/utils";
import { field, floating, mono } from "./surfaces";

export interface ComposerCommand {
  name: string;
  description: string;
  icon: LucideIcon;
}

export interface ComposerPerson {
  name: string;
  role: "agent" | "human";
}

/** Commands whose name starts with the slash query, or none when not typing one. */
export function useSlashMatches(
  value: string,
  commands: readonly ComposerCommand[] | undefined,
): ComposerCommand[] {
  return useMemo(() => {
    if (!commands || !value.startsWith("/")) return [];
    const query = value.slice(1).toLowerCase();
    return commands.filter((command) => command.name.startsWith(query));
  }, [commands, value]);
}

/** People matching a trailing @mention, or none when the caret is not in one. */
export function useMentionMatches(
  value: string,
  people: readonly ComposerPerson[] | undefined,
): ComposerPerson[] {
  return useMemo(() => {
    if (!people) return [];
    const match = /@([\w]*)$/.exec(value);
    if (!match) return [];
    const query = match[1]?.toLowerCase() ?? "";
    return people.filter((person) =>
      person.name.toLowerCase().startsWith(query),
    );
  }, [people, value]);
}

/** Replaces the trailing @mention with the chosen name. */
export function applyMention(value: string, name: string): string {
  return value.replace(/@[\w]*$/, `@${name} `);
}

function useFitInComposer(
  menuRef: RefObject<HTMLDivElement | null>,
  align: "start" | "end",
) {
  const [fit, setFit] = useState<{ shift: number; maxWidth: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return undefined;
    const bounds =
      menu.closest<HTMLElement>('[data-slot="composer"]') ??
      document.documentElement;
    const measure = () => {
      const parent = menu.offsetParent;
      if (!parent) return;
      const { left: min, right: max } = bounds.getBoundingClientRect();
      const left = parent.getBoundingClientRect().left + menu.offsetLeft;
      const width = Math.min(menu.offsetWidth, max - min);
      const shift = Math.max(min - left, Math.min(0, max - left - width));
      setFit((current) =>
        current?.shift === shift && current.maxWidth === max - min
          ? current
          : { shift, maxWidth: max - min },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bounds);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [menuRef, align]);

  return fit;
}

export const ComposerMenu = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div"> & { open: boolean; align?: "start" | "end" }
>(function ComposerMenu(
  { open, align = "start", className, style, ...props },
  ref,
) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fit = useFitInComposer(menuRef, align);
  const composedRef = useCallback(
    (node: HTMLDivElement | null) => {
      menuRef.current = node;
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
      return undefined;
    },
    [ref],
  );

  return (
    <div
      ref={composedRef}
      data-slot="composer-menu"
      data-open={open || undefined}
      style={
        fit
          ? { maxWidth: fit.maxWidth, translate: `${fit.shift}px 0`, ...style }
          : style
      }
      className={cn(
        floating,
        "absolute bottom-full z-10 mb-2 flex w-72 flex-col gap-0.5 rounded-2xl p-1.5",
        align === "start"
          ? "start-0 origin-bottom-left"
          : "end-0 origin-bottom-right",
        "transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        open
          ? "scale-100 opacity-100"
          : "pointer-events-none scale-[0.97] opacity-0",
        className,
      )}
      {...props}
    />
  );
});

export function ComposerMenuItem({
  active = false,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="composer-menu-item"
      data-active={active || undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] transition-colors",
        active ? field : "hover:bg-foreground/[0.04]",
        className,
      )}
      {...props}
    />
  );
}

export function ComposerCommandItem({
  command,
  active,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  command: ComposerCommand;
  active: boolean;
}) {
  return (
    <ComposerMenuItem active={active} {...props}>
      <command.icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="font-medium">/{command.name}</span>
      <span className="text-muted-foreground flex-1 truncate text-start text-xs">
        {command.description}
      </span>
      {active && (
        <kbd className="bg-foreground/[0.06] text-muted-foreground rounded px-1 font-mono text-[10px]">
          ↵
        </kbd>
      )}
    </ComposerMenuItem>
  );
}

export function ComposerPersonItem({
  person,
  active,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  person: ComposerPerson;
  active: boolean;
}) {
  return (
    <ComposerMenuItem active={active} {...props}>
      <span className="bg-foreground/[0.06] text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium">
        {person.name[0]}
      </span>
      <span className="flex-1 truncate text-start">{person.name}</span>
      <span className={cn(mono, "text-muted-foreground")}>{person.role}</span>
    </ComposerMenuItem>
  );
}
