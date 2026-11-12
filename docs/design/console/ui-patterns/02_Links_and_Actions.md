# UI-02 — Links & Actions

**Status:** Approved reusable design rules; engineering/documentation review still required. This is not a claim that code, Figma or `styling.md` has been updated.  
**Technical baseline:** [`apps/console/docs/styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). Preserve every nonconflicting technical requirement.  
**Legend:** **EXISTING** = verified technical baseline; **APPROVED** = design-approved target; **CHANGE** = approved update not yet implemented.  

## 1. Purpose & Scope

Canonical owner for the appearance and behavior of reusable **link categories, buttons-as-actions, Copy, row menus, external-link indicators and overflow controls**. Table row-navigation eligibility belongs to UI-01; identifier formatting to UI-03; passive domain statuses to UI-06; form submission to UI-07. Specific link destinations and screen-specific actions belong to individual product tickets.

## 2. Anatomy

Use genuine anchors/router links for destinations and buttons for actions. Reuse `CopyButton`, `RowMenu`, the installed Button and Badge components and accessible Popover/DropdownMenu primitives. Distinguish: **primary resource-name link**, **secondary referenced-configuration link**, **inline help/docs link**, **button with link appearance**, and **`+N` overflow control**. Ordinary data values and passive status badges are not links merely because they resemble them.

## 3. Visual Rules

**APPROVED:** Secondary referenced-configuration links show **`muted-foreground` at rest → `foreground` on hover**, with **no underline** at rest or hover, and clear focus-visible styling. **APPROVED:** Primary resource-name links are **not underlined on hover**; the navigable table row supplies a row-hover cue (UI-01) while the real link retains keyboard focus. These are separate semantic categories.

**EXISTING TECHNICAL CONFLICT:** `RESOURCE_ROW_LINK` currently includes `hover:underline`; a later shared change must reconcile it. Existing `Button variant="link"` styling and help/documentation link styles **do not automatically inherit** resource-name rules. Keep all styles token-based and variant-specific; do not globally restyle every anchor or invent an interactive status-badge variant.

## 4. Interaction Rules

**APPROVED:** A row navigates only when UI-01 permits it. Nested real links, Copy, menus, buttons and popovers retain their own activation, modified-click, keyboard/touch, focus, text-selection and context-menu behavior. Do not trigger double navigation.

**Copy:** Copy the **full original value**, even when the displayed text is truncated; announce confirmed success truthfully. Preserve current accessible Copy label, hover/focus reveal, touch access, and **2-second Copy→Check** confirmation. Failed clipboard writes must not claim success.

**Row actions:** Use an accessible ghost-icon action control displaying a **vertical ellipsis**, opening the existing DropdownMenu. **TECHNICAL CONFLICT:** `RowMenu` currently defaults to horizontal `Ellipsis`; reconcile the shared primitive at implementation time, preserving accessible names and supported size variants.

**`+N` overflow:** An actionable `+N` opens an accessible **Popover** containing individual linked resources **when valid destinations exist**. Values without a destination remain non-link text. The `+N` control is not a passive status Badge; its interactions do not activate the parent row.

**External links:** Actual external destinations display an external-link icon but **retain existing tab/target behavior**; do not globally force `target="_blank"`.

## 5. Variants & Exceptions

Primary, secondary, help/docs and button-style links are distinct variants. Keep any necessary exceptions tied to the semantic role, not an arbitrary screen. Passive `Latest`, `In use`, `Active`, `Blocked` and similar states belong to UI-06 and are not buttons by default. A missing destination is not an invitation to invent a route.

## 6. States & Responsive Behavior

All interactive elements expose meaningful pointer hover, visible keyboard focus, appropriate disabled/pending behavior for real actions, accessible names and practical touch targets. Copy remains operable without hover. Escape dismisses menus and popovers without activating the row; text selection and native context menus keep working. Do not rely on tooltips as the sole means of copying or understanding values.

## 7. Design & Implementation References

**Technical:** [`ui/button.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/ui/button.tsx), [`ui/badge.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/ui/badge.tsx), [`ui/copy-button.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/ui/copy-button.tsx), [`resource-list.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/resource-list.tsx). **Design System:** [Button variants](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=37-931), [Button Link default](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=60-244), [Button Link hover](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=979-19808). Button Link references are **not** proof of the approved distinct secondary-reference link style; it remains an approved rule to implement at component level. Product-screen evidence belongs in screen-level reviews.

## 8. Verification Criteria

- [ ] Primary resource-name links: no hover underline, real link focus, valid destination and appropriate row-hover cue.
- [ ] Secondary reference links: muted→foreground without underline; focus-visible and independently navigable.
- [ ] Copy operates on the complete original value; truthful status announcement and two-second visual confirmation; keyboard/touch support.
- [ ] Vertical-ellipsis row menu reconciled with existing horizontal icon implementation; no accessibility regressions.
- [ ] `+N` popover has independent links where valid; passive statuses remain noninteractive.
- [ ] External destinations have an external-link icon without an unapproved change to tab semantics.
- [ ] Test focus, modified clicks, selection, overflow and dismissal across relevant generic variants; individual screen routing is verified in screen-level tickets.