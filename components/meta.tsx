"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * Small accessible dot used between a primary and secondary text fragment.
 * Replaces the raw "·" character so the separator aligns optically,
 * inherits the surrounding muted tone, and stays hidden from screen readers.
 */
export function MetaDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mx-1.5 inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-current align-middle opacity-40",
        className,
      )}
    />
  );
}

/** Inline `main · secondary` row that keeps single-line truncation intact. */
export function MetaInline({ parts, className }: { parts: Array<string | null | undefined | false>; className?: string }) {
  const visible = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  if (!visible.length) return null;
  return (
    <span className={cn("min-w-0", className)}>
      {visible.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {index > 0 && <MetaDot />}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
