import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Badges are tinted, never filled: a 13–16% wash of the signal colour behind
// the colour itself, which keeps a dense row of them from shouting.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-meta-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-white",
        secondary: "bg-soft text-t2 [a&]:hover:bg-elev [a&]:hover:text-t1",
        destructive: "bg-danger/14 text-danger focus-visible:ring-destructive/30",
        warning: "bg-warn/14 text-warn",
        success: "bg-good/14 text-good",
        brand: "bg-brand/14 text-brand-hover",
        outline:
          "border-line text-t2 [a&]:hover:bg-elev [a&]:hover:text-t1",
        ghost: "[a&]:hover:bg-elev [a&]:hover:text-t1",
        link: "text-brand underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
