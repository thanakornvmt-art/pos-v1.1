import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const variants = cva(
  "inline-flex min-h-16 min-w-16 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-primary text-ink hover:bg-[#eaaa00]",
        outline:
          "border-2 border-stone-300 bg-white text-stone-900 hover:bg-stone-100",
        destructive: "bg-red-700 text-white hover:bg-red-800",
        ghost: "text-stone-700 hover:bg-stone-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variants> {
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(variants({ variant, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
