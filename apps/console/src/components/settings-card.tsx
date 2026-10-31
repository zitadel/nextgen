import type { ReactNode } from "react";

import { DETAIL_CARD } from "@/components/detail-page";
import { SECTION_HEADING } from "@/components/typography";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";

/**
 * One section of a settings screen: a section heading and a line saying what
 * it holds, then its card, 24px under the title row or the section above.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className={SECTION_HEADING}>{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The card a settings section holds its rows in: the detail shell's body card
 * (`detail-page.tsx`), with the rows in a `FieldGroup` so a
 * `<Field orientation="responsive">` reads the card's own width — label
 * beside the control when the card is wide, stacked when it is narrow, with no
 * viewport breakpoint.
 */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card className={DETAIL_CARD}>
      <CardContent className="px-6 py-5">
        <FieldGroup className="gap-4">{children}</FieldGroup>
      </CardContent>
    </Card>
  );
}
