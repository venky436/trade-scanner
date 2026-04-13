"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

// ── Root + Value ──

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

// ── Trigger ──

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "inline-flex h-9 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-sm transition-colors",
        "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300/40",
        "dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:border-zinc-700 dark:focus:border-zinc-600 dark:focus-visible:ring-zinc-700/40",
        "data-[popup-open]:border-zinc-400 dark:data-[popup-open]:border-zinc-600",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <SelectPrimitive.Icon>
        <ChevronDown className="size-3.5 text-zinc-500 transition-transform data-[popup-open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

// ── Popup (the dropdown panel) ──

function SelectContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & { sideOffset?: number }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={sideOffset} alignItemWithTrigger={false}>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "z-50 min-w-[--anchor-width] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-black/5",
            "dark:border-zinc-800/80 dark:bg-zinc-950/95 dark:shadow-black/40",
            "backdrop-blur-xl",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-150",
            className,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

// ── Item (individual option) ──

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-xs font-medium text-zinc-700 outline-none transition-colors",
        "data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900",
        "dark:text-zinc-300 dark:data-[highlighted]:bg-zinc-800/60 dark:data-[highlighted]:text-zinc-100",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
