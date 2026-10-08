import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap border",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        positive: "border-transparent bg-[var(--stat-strength-soft)] text-[var(--stat-strength-readable)]",
        negative: "border-transparent bg-[var(--stat-weakness-soft)] text-[var(--stat-weakness-readable)]",
        accent: "border-transparent bg-[var(--accent-soft)] text-[var(--ui-accent-foreground)]",
      },
      size: {
        default: "rounded-md px-2 py-0.5 text-xs font-medium",
        compact: "inline flex-none rounded-[var(--radius-sm)] border-0 px-1 py-[2px] text-[length:var(--type-caption)] font-bold",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

function Badge({ className, variant, size, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
