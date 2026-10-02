import type { ReactNode } from "react";

import { DETAIL_BODY } from "@/components/detail-page";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";

/**
 * The card a settings screen holds its rows in: the detail shell's body card
 * (`detail-page.tsx`), 24px under the title row, with the rows in a
 * `FieldGroup` so a `<Field orientation="responsive">` reads the card's own
 * width — label beside the control when the card is wide, stacked when it is
 * narrow, with no viewport breakpoint.
 */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card className={`${DETAIL_BODY} gap-0 rounded-xl py-0`}>
      <CardContent className="px-6 py-5">
        <FieldGroup className="gap-4">{children}</FieldGroup>
      </CardContent>
    </Card>
  );
}
