import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * Buttons follow the handoff's metrics: 31px tall, 8px radius, 12.5px/600
 * label, 7px gap to a 13px icon. The primary action is a light fill on dark
 * text; secondaries are a hairline border over the page with `t2` text that
 * brightens on hover. Nothing here is permanently loud.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-[7px] rounded-md text-body-sm font-semibold whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[13px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-white",
        destructive:
          "bg-danger/14 text-danger hover:bg-danger/20 focus-visible:ring-destructive/30",
        outline:
          "border border-line bg-transparent text-t2 hover:bg-elev hover:text-t1",
        secondary: "bg-soft text-t2 hover:bg-elev hover:text-t1",
        ghost: "text-t2 hover:bg-elev hover:text-t1",
        link: "text-brand underline-offset-4 hover:text-brand-hover hover:underline",
      },
      size: {
        default: "h-[31px] px-3 has-[>svg]:pl-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-label tracking-normal [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-meta has-[>svg]:pl-2",
        lg: "h-9 rounded-md px-5",
        icon: "size-[31px]",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
