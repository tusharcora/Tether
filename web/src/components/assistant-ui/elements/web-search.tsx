// assistant-ui element (github.com/assistant-ui/assistant-ui, MIT), verbatim but for import paths, the source count (it read a fixed "3") and a row key that two results from one domain shared.
"use client";

import type { ComponentProps } from "react";
import { SearchIcon } from "lucide-react";
import { cn } from "../../beui/lib/utils";
import { field, mono, ShimmerLabel } from "./surfaces";
import { take } from "../utils/range";

export interface WebSearchResult {
  title: string;
  domain: string;
}

export function WebSearch({
  query,
  results,
  visibleResults,
  searching,
  cycle,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "query" | "results" | "visibleResults" | "searching" | "cycle"
> & {
  query: string;
  results: readonly WebSearchResult[];
  visibleResults: number;
  searching: boolean;
  cycle: number;
}) {
  return (
    <div
      data-slot="web-search"
      className={cn("flex w-full max-w-sm flex-col gap-2.5", className)}

      {...props}
    >
      <span
        className={cn(
          field,
          "text-foreground/70 inline-flex w-fit items-center gap-1.5 rounded-full px-3.5 py-2 text-xs",
        )}
      >
        <SearchIcon className="text-muted-foreground size-3" />
        {query}
      </span>
      <div className="text-muted-foreground text-xs">
        {searching ? (
          <ShimmerLabel className="relative inline-block leading-none">
            Searching
          </ShimmerLabel>
        ) : (
          <span className="fade-in animate-in duration-300">
            Read {results.length} {results.length === 1 ? "source" : "sources"}
          </span>
        )}
      </div>
      <div className="flex min-h-[5.75rem] flex-col">
        {take(results, visibleResults).map((result, index) => (
          <div
            key={`${cycle}-${index}-${result.domain}`}
            className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both hover:bg-foreground/[0.03] -mx-2.5 flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors duration-300"
          >
            <span className="bg-foreground/[0.06] text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-medium">
              {result.domain.charAt(0).toUpperCase()}
            </span>
            <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13.5px]">
              {result.title}
            </span>
            <span className={cn(mono, "text-muted-foreground shrink-0")}>
              {result.domain}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
