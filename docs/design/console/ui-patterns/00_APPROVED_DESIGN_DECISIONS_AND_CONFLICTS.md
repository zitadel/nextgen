# ZITADEL UI Polishing — Approved Design Decisions & Baseline Conflicts

**Status:** Reviewed design intent, not a claim that implementation has been completed. UI-01–UI-07 are approved targets for reusable patterns. Feature and routing behavior remains governed by current specifications, accepted ADRs and merged implementation PRs; technical conventions not superseded by an approved pattern remain in [styling.md](../../../../apps/console/docs/styling.md).

## 1. Approved reusable pattern decisions

| Decision | Approved intent | Canonical rule |
|---|---|---|
| DEC-01 | Resource-list header **44px**, header labels **`muted-foreground`**, body rows still **56px** (default `comfortable` density; compact lists see §4) | UI-01 |
| DEC-02 | A row opens a real primary detail route only when one exists; nested actions/links remain independent | UI-01; UI-02 for link controls |
| DEC-03 | Secondary referenced-configuration links muted at rest → foreground on hover, **no underline** | UI-02 |
| DEC-05 | Keep `formatRecent()`'s **24h** rule; after 24h show localized date + time, per existing formatter | UI-03 |
| Round 1 #1 | Primary resource-name links **no hover underline**; row hover signals navigation | UI-02 / UI-01 |
| Round 1 #3 | Actionable `+N` opens a Popover with individually linked resources when real targets exist | UI-02 |
| Round 1 #5 | External-link icon on actual external links; preserve existing tab behavior | UI-02 |
| Round 2 #6 | Resource-detail pages share a common page-level title/optional truthful metadata/content hierarchy; preserve unique content/actions | UI-04; GLOBAL-PAGE-01 for all Console pages |
| Round 2 #8 | Format dates or date + time according to the field's actual semantics; existing 24h relative date rule remains | UI-03 |
| Round 2 #9 | Remove genuinely redundant descriptions selectively; preserve useful guidance | UI-03; individual copy decisions made per screen |
| Round 2 #10 | Keep current Console type scale on desktop/mobile; fix only actual wrapping defects | UI-03 |
| Round 3 #11 | Use existing Card border/elevation variants; no new blanket card treatment | UI-05 |
| Round 3 #12 | Use existing Badge variants, with truthful backend domain mappings; passive status is not interactive | UI-06 |
| Round 3 #13 | Genuine first-use empty → informative state with a relevant CTA; filtered empty → compact no-results state | UI-06 |
| Round 3 #14 | Contextual inline success or existing Sonner toast; no toast-after-every-change rule | UI-06 |
| Round 3 #15 | Action loading only while request is pending; prevent duplicate submissions; persistent domain `Pending` stays truthful | UI-06 |
| Round 4 #16 | Only optional labels show `(optional)`; no global required `*` | UI-07 |
| Round 4 #17 | Client errors on blur after interaction and on submit; update visible errors during corrections | UI-07 |
| Round 4 #18 | Meaningful helper text beneath the relevant input/control only where needed | UI-07 |
| Round 4 #19 | In-app Create/Edit defaults to FormSheet; confirmations use Dialog; preserve intentional inline/standalone exceptions | UI-07 |
| Round 4 #20 | Destructive confirmations name the action, explain consequence and offer clear Cancel | UI-07 |
| Round 5 #26 | Filter/search with zero results → compact message **within the table area**, not below | UI-06 |
| Additional approved | Existing three-dot row-actions **right-pinned/sticky** wherever present, even without scrolling; no new menus or width changes | UI-01 |
| Additional approved | Configuration-directory primary-name icons may be omitted; meaningful resource/action/secondary icons preserved; role-specific icon stroke | UI-01 / UI-05 |
| Additional approved | Identifiers **12px monospace**, middle-truncated when constrained, full Copy remains available | UI-03 / UI-02 |

## 2. Previously approved screen-specific applications — for later UI Polishing tickets

**These decisions remain approved but are not global component requirements.** Recording them here avoids losing prior decisions without embedding one screen's columns, route or copy in a reusable UI Pattern MD. Each future implementation ticket must check its actual Figma screen and current code independently.

| Decision | Existing approval / concrete application | Future owner |
|---|---|---|
| DEC-04 / Round 1 #2 | The **Users** table has a visible text-labelled `Columns` control, right aligned within its table toolbar. UI-01 defines how the configurable-columns *variant* behaves, not which screens must offer it. | Users screen-level polishing |
| Round 1 #4 | A row in the **Deployments** directory opens its corresponding detail view **under Deployments**, where Release details are shown; verify the actual destination against the existing Release detail route. | Deployments screen-level routing review |
| Round 2 #7 | **Login Flow detail** title and MetaItems appear above/outside its configuration panel; no duplicate page title. This is a concrete application of the shared detail hierarchy. | Login Flow screen-level polishing |
| Round 2 #9 application | Remove the specifically identified redundant subtitle beneath **Anmelden**, not all supporting text. | Sign-in screen-level polishing |
| Additional Users approval | Primary identity: the server-resolved display name with the designated identifier beneath (`x-display` / `x-identifier`, ID as fallback; [ADR 058](../../../adrs/058-user-identity-designation-and-references.md) §3a), **ID in its own column**, without redundant identifier-property chips. Actual data and avatar fallback require screen review. | Users screen-level polishing |
| Additional Team approval | An inactive **Team** is labelled `Inactive` rather than an unrelated `Disabled`/`Blocked` state; global status API mappings remain domain-specific. | Teams screen-level polishing |
| Login Flows columns (2026-11-03) | Existing reviewed Figma layout uses **Name, Purpose, User Schema, Last Change, Actions**, **without Steps**. This does not define a global table variant or change any table widths. | Login Flows screen-level polishing |

**Boundary:** Individual table column sets, CLI helper footers, route-specific exceptions, one-off error screenshots, copy details and exact API mappings **belong in future UI polishing tickets**. Their absence from Pattern MDs is deliberate, not a forgotten design decision.

## 3. Global Page Layout and Navigation — separate from UI patterns

These decisions do not belong in the seven reusable component guides. The current source for routing and shell behavior is [Console ADR 0001](../../../../apps/console/docs/adrs/0001-console-routing.md); [Console ADR 0005](../../../../apps/console/docs/adrs/0005-team-navigation.md) governs the current team-as-resource versus future team-as-scope boundary.

- **GLOBAL-PAGE-01:** Page Title → optional truthful Metadata → Content; preserve page-specific layout and content widths.
- **Round 5 #21–22:** Preserve approved page widths, responsive layouts, existing dark canvas and Card contrast.
- **Round 5 #23:** Projects uses the shared sidebar and shell, as decided in D27 (superseding D24).
- **Round 5 #24 (superseded):** The earlier Users landing is obsolete. D35 and Console ADR 0001 establish Project Overview as the landing with a selected project; unselected-project behavior follows the routing guard.
- **Round 5 #25:** Keep Project/Team context navigation discoverable where supported. Do not infer a global Team scope that is not yet implemented (Console ADR 0005).
- **Additional reviewed navigation:** Inactive sidebar entries use muted styling, and active state tracks the actual route. Screen-level review still governs precise placement.

## 4. Explicit conflicts with current `styling.md` / source code

| Current technical baseline | Approved future design | Required reconciliation |
|---|---|---|
| Resource-list head **56px** (`comfortable`) and head label `foreground`; `compact` density is **40px** head and rows (Events) | **44px**, `muted-foreground` for `comfortable` lists | Update the **resource-list head only**, not panel heads or 56px body cells. Head and body share `--resource-row` today, so the head needs its own height. Keep `compact` heads, rows and padding unchanged until a compact target is reviewed |
| `RESOURCE_ROW_LINK` `hover:underline` | Resource-name link **without** hover underline | Shared link style and native focus QA |
| `ResourceIdCell` already uses `IdText` with middle truncation | **12px monospace** is the reviewed typography target | Preserve middle elision and full-value Copy; verify typography implementation |
| Current `RowMenu` default horizontal `Ellipsis` | Vertical ellipsis | Shared control icon update; preserve DropdownMenu/accessibility |
| `styling.md` multiple resource-detail header compositions | Shared title/optional Meta/content hierarchy | Preserve existing shell, widths, tabs, content, permissions and API actions |
| D24 originally described Projects without the sidebar | D27 supersedes D24; shared shell/sidebar is current | Follow Console ADR 0001, not a deferred UI-01–07 pattern |
| `styling.md` describes `SUBSECTION_HEADING`; `typography.ts` does not export it | No new design style approved | **Technical documentation/code reconciliation** required; do not invent symbol |
| Forms have varying current optional/validation/helper conventions | Approved field marker, blur/submit timing and helper placement | Shared convention rollout with actual field/API/accessible validation |

All other valid technical contracts remain unchanged: shadcn/new-york/Radix component track; semantic tokens; `rounded-md` 8px; table/panel variants and existing sizes; `Page` shell; form/error semantics; native links, Copy, keyboard/touch, responsive pinned-column behavior and truthful backend state.

### Historical decision alignment — checked 2026-11-12

- D5 cursor-backed **Load more** and D19's **primary list action beside the title** are in UI-01. D15 and D18 are addressed by UI-07 and UI-05.
- **D13 is standing**, not a deferred design gate: no page-level Back buttons or breadcrumbs. Chevron navigation headings under D29, D30 and D40 implement navigation up through the sidebar, as described by Console ADR 0001.
- **D23 is partly superseded by approved Users-table design intent:** D23 says the Columns menu is right-click-only and mandates an identifier-property chip; UI-01 expects a visible labelled Columns control, and the reviewed Users screen has no type chip. Open [PR #2817](https://github.com/zitadel/nextgen/pull/2817) proposes that change but is not merged. Its proposed D27 ID collides with the D27 already on main. Retain D23's pinning, Attributes popover, sticky menu and table widths.
- D2's irreversible hard-delete premise conflicts with accepted [ADR 024](../../../adrs/024-user-team-lifecycle-ownership.md), which specifies deactivation/tombstoning before purge. Do not copy that older premise into a new general rule.
- D35, D40 and the current shell are documented in Console ADR 0001; Search product UX decisions D32, D33, D37 and D39 remain in the active decision log, alongside [ADR 087](../../../adrs/087-search.md), which is still **Proposed**.
- **Settings navigation scope:** **Account → Settings → Profile Settings** and **Project → Settings → General / Admins** are distinct Settings areas, both using the new second-level sidebar. The referenced [internal Project Settings Figma view](https://www.figma.com/design/j3qqriDab6WQfrlgLujf4Y/?node-id=4444-107755) still depicts the earlier navigation; it is not the updated navigation baseline. This is a navigation clarification, not a new resource-detail pattern.
- **D40/D41** (2026-11-11) give Users, Teams, Login Flows, Identity Providers, Releases **and Project Settings** one shared detail composition. **Project Settings General and Admins** retain the project header (name, ID, created date), while global/account Settings (for example Profile) are not automatically resource detail pages. D41 specifies a 218px label rail, medium-weight labels, inputs and section asides aligned to that rail, 16px on either side of row rules and no final rule. UI-04 now documents this approved target explicitly; `styling.md` remains the current technical baseline pending implementation reconciliation. D40 governs Settings subnavigation separately.
- The decisions log stays **active**; it is not frozen or archived. Moving feature-specific decisions to maintained specifications or ADRs is separate work.

## 5. Remaining reviews — NOT pending global design decisions

- **Engineering verification:** actual routes, API state→Badge mappings, configurable-column schema data/permissions, ID elision, `SUBSECTION_HEADING` mismatch, form exception/validation rollouts, accessible interactions and regression QA.
- **Screen review / individual tickets:** concrete table column sets, route/toolbar labels, copy variants, visual before/after and particular screen layouts, including the previously approved applications in §2.
- **Figma/documentation:** internal Design System/component and product-screen references may support private prelaunch review. Before public documentation, omit or replace private UI Working File links. A curated public file is optional; no new interaction decision is created by its absence.
- **Documentation QA:** Check that linked design references are accessible to intended reviewers and verify responsive and focus states during implementation review.

**Workflow:** Approved design specification → documentation PR → implementation/reconciliation → UI QA. This register does not replace current feature specifications or technical ADRs.
