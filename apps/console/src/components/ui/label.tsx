"use client";

import type * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { FIELD_LABEL_TYPOGRAPHY } from "@/components/typography";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        FIELD_LABEL_TYPOGRAPHY,
        className,
      )}
      {...props}
    />
  );
}

export { Label };
