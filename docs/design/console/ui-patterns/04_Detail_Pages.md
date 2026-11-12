# UI-04 — Detail Pages

**Status:** Approved reusable design rules; engineering/documentation review still required. This is not a claim that code, Figma or `styling.md` has been updated.  
**Technical baseline:** [`apps/console/docs/styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). Preserve every nonconflicting technical requirement.  
**Legend:** **EXISTING** = verified technical baseline; **APPROVED** = design-approved target; **CHANGE** = approved update not yet implemented.  

## 1. Purpose & Scope

Canonical owner of the **reusable detail-page composition**: resource title, truthful metadata, relevant tabs/sections, content panels and actions. The global Title → optional Meta row → Content Area hierarchy for **all** Console pages is defined only in **GLOBAL-PAGE-01** in the central decision register. Global shell dimensions, route structure and navigation belong to separately deferred Page Layout & Navigation work. **Which information a particular resource displays is screen-specific.**

## 2. Anatomy

**EXISTING technical baseline:** `styling.md` has multiple detail compositions (`Page` + `DetailHeader` + `DETAIL_BODY`, `DetailTitle` with an identity line, in-panel `DetailPanel`/`PanelTitle`, and settings-specific `SettingsColumn`/`SettingsCard`). Their shared layout helpers and actual data/permission contracts remain in effect until updated.

**APPROVED target:** Resource details share one **common page-level title → truthful optional resource MetaItems → content** structure. Title and metadata sit **outside/above** the relevant content panel; they are not duplicated as another page title inside it. Existing tabs, content sections, configuration panels, actions, permissions and resource data remain distinct within that common shell. Never synthesize an empty metadata row or falsify fields. Settings screens are not automatically resource-detail screens.

## 3. Visual Rules

**Technical baseline to reconcile (not new specifications):** Existing page gutter 16px, top 20px at `lg`, resource header gutter 24px, title lockup using the documented 36px icon tile / 12px gap / `PAGE_TITLE` role where applicable, metadata card insets and existing body spacing. **APPROVED:** Align only page-level title/metadata hierarchy across detail types. Preserve valid existing typography, `rounded-md`, semantic tokens, per-page width and existing dark canvas; do not infer a new dimension from one mock. Precise shared layout geometry requires verification against approved Design System components and current implementation before rollout, rather than a new ad hoc constant.

Identifiers use UI-03; real Copy actions use UI-02. Metadata labels must reflect actual source fields and domain semantics.

## 4. Interaction Rules

Tabs switch actual content while keeping focus/keyboard access. Nested links and Copy do not activate parent navigation; resource actions retain existing permissions and backend behavior. Do not change edit/save/rename/destructive semantics under the label of layout polishing. Domain state distinctions (e.g. latest/in-use/live) follow UI-06 and real API evidence, not the visual position of a label.

## 5. Variants & Exceptions

The **page-level hierarchy is common**, while resource-specific tabs, content cards, configuration forms, available actions and data fields remain legitimate variants. Existing configuration panels may continue as **content**, not as independent alternative page headers. A directory or settings page with no resource MetaItems follows GLOBAL-PAGE-01 without a fabricated metadata row. **Do not add new resource routes, reorganize navigation, change page/table widths or remove valid fields as a side effect**. Exact screen mapping and migrations belong to their own UI-polishing tickets.

## 6. States & Responsive Behavior

At narrow widths, long titles and truthful metadata wrap/stack without clipping; tabs and actions stay keyboard/touch accessible. Do not show false loading/empty/error content, hide useful information or invent placeholder metadata. State semantics belong to UI-06; form state composition belongs to UI-07. Preserve existing shell and per-page widths until separately authorized Page Layout rollout.

## 7. Design & Implementation References

**Technical:** [`styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md), [`detail-page.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/detail-page.tsx), [`detail-meta.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/detail-meta.tsx), [`settings-card.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/settings-card.tsx). **Design System:** [Console Page Header component collection](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=28677-18532) and [Detail Panel component collection](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=28070-46423) are existing component references, **not proof of the approved final shared detail composition**. **Global hierarchy:** `00_APPROVED_DESIGN_DECISIONS_AND_CONFLICTS.md` → GLOBAL-PAGE-01. Do not substitute an arbitrary private screen as a shared master. Screen-level Before/After references belong to their individual reviews/tickets.

## 8. Verification Criteria

- [ ] Every resource detail follows the approved title → truthful/optional MetaItems → content hierarchy with no duplicated in-panel page title.
- [ ] Preserve valid existing tabs, forms, permissions, content panels, data fields and routes; no information silently removed.
- [ ] Maintain existing shell insets, distinct page widths and dark canvas unless separately approved.
- [ ] ID presentation and Copy comply with UI-03/UI-02; domain status claims comply with UI-06.
- [ ] Review actual shared detail component/spacing versus `styling.md` before migration; record intentional replacements rather than silently dropping technical rules.
- [ ] Check responsive wrapping, focus and genuine Before/After for affected resource views in their own tickets, not as additional global pattern decisions.
