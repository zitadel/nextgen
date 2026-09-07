import type { ReactNode } from "react";

import { EYEBROW } from "@/components/detail-meta";
import { Card } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";

/**
 * The settings detail card — Figma `detailPanel/settingsUser` (`1718:21233`
 * wide / `1718:23527` narrow; the component set doc-links shadcn `Card`).
 *
 * A `Card` re-set to the settings frames' geometry: 8px radius (`rounded-md`,
 * where the Card default is `rounded-xl`), the `foreground/10` hairline the
 * node's border resolves to (the same token the account dropdown uses —
 * interchangeable with `border` on the light canvas and visibly not on the
 * dark one), `shadow-xs`, and a 24×20 body.
 *
 * Children are the card's rows; they render inside a `FieldGroup` so a
 * `<Field orientation="responsive">` row reads the *card's* width — label-left
 * beside the control in the wide frame, stacked in the narrow one — without a
 * viewport breakpoint.
 *
 * `label` renders the component's section header (`PROFILE INFORMATION` +
 * divider). The frames keep it hidden in their resting state, so it is
 * optional and off by default — it exists because the component defines it and
 * #916 asks for the pattern to be reusable, not because the Profile screen
 * shows it.
 */
export function SettingsCard({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <Card className="gap-0 rounded-md border-foreground/10 py-0 shadow-xs">
      <div className="flex flex-col gap-4 px-6 py-5">
        {label && (
          <>
            <span className={EYEBROW}>{label}</span>
            <Separator />
          </>
        )}
        <FieldGroup className="gap-4">{children}</FieldGroup>
      </div>
    </Card>
  );
}
