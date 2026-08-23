"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 ease-state disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // High emphasis. Solid teal — used once per view, for the action the
        // whole view exists to enable.
        primary:
          "bg-signal-500 text-ink-950 shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset] hover:bg-signal-400 active:bg-signal-600",
        // Default product action.
        secondary:
          "border border-ink-550 bg-ink-700/80 text-ink-50 hover:border-ink-500 hover:bg-ink-600/80 active:bg-ink-700",
        // Low emphasis, still a button.
        ghost: "text-ink-200 hover:bg-ink-700/70 hover:text-ink-50",
        // Reads as a link but behaves as a button.
        link: "text-signal-400 underline-offset-4 hover:text-signal-300 hover:underline",
        // Destructive / retry-after-failure.
        danger: "border border-fault-500/40 bg-fault-900/60 text-fault-400 hover:bg-fault-900 hover:text-fault-400",
        // Marketing outline on dark cinematic ground.
        outline:
          "border border-ink-500/70 bg-ink-900/40 text-ink-50 backdrop-blur-sm hover:border-signal-500/50 hover:bg-ink-800/60",
      },
      size: {
        xs: "h-7 rounded-sm px-2.5 text-ui-xs [&_svg]:size-3.5",
        sm: "h-8 rounded-md px-3 text-ui-sm [&_svg]:size-4",
        md: "h-9 rounded-md px-4 text-ui-base [&_svg]:size-4",
        lg: "h-11 rounded-lg px-6 text-ui-lg [&_svg]:size-[18px]",
        icon: "size-8 rounded-md [&_svg]:size-4",
        "icon-sm": "size-7 rounded-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(button({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { button as buttonVariants };
