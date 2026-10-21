import type { ReactNode } from "react";

import { DETAIL_BODY, DETAIL_CARD } from "@/components/detail-page";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * The card a settings screen holds its rows in: the detail shell's body card
 * (`detail-page.tsx`), 24px under the title row, with the rows in a
 * `FieldGroup` so a `<Field orientation="responsive">` reads the card's own
 * width — label beside the control when the card is wide, stacked when it is
 * narrow, with no viewport breakpoint. `className` moves it, e.g. closer
 * under a section heading.
 */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn(DETAIL_BODY, DETAIL_CARD, className)}>
      <CardContent className="px-6 py-5">
        <FieldGroup className="gap-4">{children}</FieldGroup>
      </CardContent>
    </Card>
  );
}
