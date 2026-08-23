"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * PanelShell — the frame every workspace column and drawer sits in.
 *
 * Header stays fixed, body scrolls, footer pins to the bottom. Centralised so
 * three panels and a drawer cannot drift into three different paddings, and so
 * each one gets a real landmark role with an accessible name.
 */

// `title` is widened to ReactNode for a rendered header, which is not the
// DOM's string-only tooltip attribute — so it is omitted and redeclared.
export interface PanelShellProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  /** Rendered at the right edge of the header row. */
  actions?: React.ReactNode;
  /** A second header row — filters, tabs, search. */
  subheader?: React.ReactNode;
  footer?: React.ReactNode;
  as?: "aside" | "section" | "div" | "main";
  /** Accessible name when `title` is not a plain string. */
  label?: string;
  bodyClassName?: string;
  /** Turns off the body's own scroll container (for canvas panels). */
  scroll?: boolean;
}

export const PanelShell = forwardRef<HTMLElement, PanelShellProps>(
  (
    { title, actions, subheader, footer, children, className, bodyClassName, as = "section", label, scroll = true, ...props },
    ref,
  ) => {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        className={cn("flex min-h-0 min-w-0 flex-col bg-ink-800/40", className)}
        {...props}
      >
        {(title || actions) && (
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-600/70 px-3">
            {typeof title === "string" ? (
              <h2 className="truncate text-ui-sm font-medium text-ink-50">{title}</h2>
            ) : (
              title
            )}
            {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
          </header>
        )}
        {subheader && <div className="shrink-0 border-b border-ink-600/70 px-3 py-2">{subheader}</div>}
        <div className={cn("min-h-0 flex-1", scroll && "overflow-y-auto overscroll-contain", bodyClassName)}>
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-ink-600/70 px-3 py-2.5">{footer}</div>}
      </Comp>
    );
  },
);
PanelShell.displayName = "PanelShell";

/** A labelled group inside a panel body. */
export function PanelSection({
  title,
  action,
  children,
  className,
  dense,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section className={cn("border-b border-ink-600/50 last:border-b-0", dense ? "px-3 py-2.5" : "px-3 py-3.5", className)}>
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="eyebrow">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label/value row used throughout the inspector. Values are monospace when
 *  they are identifiers or measurements. */
export function FieldRow({
  label,
  children,
  mono,
  className,
  title,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-3 py-1", className)}>
      <dt className="w-28 shrink-0 text-ui-2xs text-ink-400">{label}</dt>
      <dd
        className={cn("min-w-0 flex-1 break-words text-ui-xs text-ink-100", mono && "font-mono tabular text-ui-2xs")}
        title={title}
      >
        {children}
      </dd>
    </div>
  );
}
