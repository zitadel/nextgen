# UI-01 — Tables & Resource Lists

**Status:** Approved reusable design rules; engineering/documentation review still required. This is not a claim that code, Figma or `styling.md` has been updated.  
**Technical baseline:** [`apps/console/docs/styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). Preserve every nonconflicting technical requirement.  
**Legend:** **EXISTING** = verified technical baseline; **APPROVED** = design-approved target; **CHANGE** = approved update not yet implemented.  

## 1. Purpose & Scope

Canonical specification for **reusable table and resource-list anatomy, visual geometry, row navigation, configurable-column controls, sticky row actions and responsive behavior**. It applies wherever the respective table variant is used. **Individual screen column sets, labels, data values, exact routes, toolbars and one-off UI defects belong in later screen-level polishing tickets, not here.** Do not change existing table widths or column widths.

Link appearance is owned by UI-02, ID typography by UI-03, state semantics by UI-06. Global Page Layout and Navigation are separate and deferred; see the central decisions register.

## 2. Anatomy

**EXISTING:** Compose the shared `Page`, `ResourceTitle` (action and optional filter slots), `ResourceHeaderRow`, `ResourceHeadCell`, `ResourceRow`, `ResourceEmptyRow` and `LoadMore` from `resource-list.tsx`. Reuse the shared cells and row-action slot rather than implementing parallel screen-specific table primitives.

**EXISTING — primary list action placement (historical D19):** The list’s primary Create/Add action stays in `ResourceTitle`’s `action` slot beside the page title at every supported breakpoint. Do not stretch it to full width, move it below the title, or substitute a new layout merely because filters wrap. Filters remain in their separate `filter` slot. This restates the existing Console list contract; it does not prescribe screen-specific button labels.

**PRESERVE baseline layout contracts from `styling.md`:** page gutter 16px (24px at `sm` with panel inset), page top 20px at `lg` / 16px below, list header gutter 24px at `lg` / 16px below, title row 36px, table top gap 20px at `lg` / 16px below, body cell height **56px** and horizontal inset 24px. Header cells retain the existing **24px leading / 16px trailing** insets. Preserve existing screen toolbar composition and per-table column layout.

Resource identity cells should display meaningful, nonduplicated identity information; when an identifier has its own column, do not unnecessarily repeat it within the main identity cell. **The exact fields and columns of each screen are not defined here.**

## 3. Visual Rules

**APPROVED CHANGE:** The shared **resource-list table head** becomes **44px** high, with labels using `muted-foreground` rather than the current 56px / `foreground` baseline. Preserve the existing head-label display face **12/16 with 0.72px tracking**. Body rows remain **56px**. This does **not** change `PANEL_HEAD_CELL`, unrelated panel tables or `PAGE_TITLE_ROW`.

**APPROVED reusable icon eligibility:** Decorative primary-name icons are omitted from **configuration-reference directories**; meaningful resource-identity icons in **resource directories** remain, as do independently meaningful secondary-cell, navigation, status, header and action icons. Do not remove icons indiscriminately. For the existing resource-row icon role, preserve **16px Lucide / 1.5 stroke**, not a globally inferred 0.6 stroke. Specific directory applications are reviewed at screen level.

Standard values use `foreground`; genuinely absent values may use a muted `—`. IDs use the canonical UI-03 **12px monospace / middle truncation where constrained**, with full original Copy via UI-02. No misleading identifier-type decoration when the actual identity remains readable. A resource-name link is **not underlined on hover** (UI-02).

## 4. Interaction Rules

**APPROVED:** A resource row may open a primary detail destination only **where a real route exists**. Clicking noninteractive row space opens that destination. Independent links, Copy controls, menus, popovers, inputs and buttons act on themselves only; they must not activate the enclosing row. Preserve native anchor semantics, modified clicks, keyboard focus, selection and touch. Rows without a valid destination must not imply navigation.

**APPROVED — sticky row actions:** Every applicable table **already providing a three-dot row-action menu** retains a dedicated **right-pinned/sticky trailing action column**. It stays present and aligned even when all content fits, the table contains few rows/columns, or horizontal overflow has not yet appeared. Preserve existing action-column, sticky-edge, scroll and breakpoint behavior. **Do not add a row menu to a table that does not have meaningful actions solely to satisfy this rule.** Menu icon and control behavior belong to UI-02.

**EXISTING — cursor paging (historical D5, API ADR 027):** For lists that support incremental loading, keep the existing cursor-based `LoadMore` pattern rather than introducing numbered/offset pagination. Show `Load more` only while the API indicates a next page. Do not display a total result count unless an API explicitly provides a trustworthy count; a partially loaded page is not the entire collection. This does not mandate pagination controls on lists whose data fits or whose APIs do not expose paging.

**Configurable-columns variant:** Where optional column configuration is provided, use a discoverable **text-labelled `Columns` control at the right of the table toolbar**, not an icon-only or right-click-only affordance. Existing mandatory columns remain available and individual optional selections must be operable without repeatedly reopening the control. This defines the variant's interaction, **not a mandate to add column configuration to every table**. Available attributes, duplicates, permission filtering and persistence must be verified against the implementation.

## 5. Variants & Exceptions

**APPROVED — NO TABLE-SIZING CHANGES:** Preserve every table's existing overall width, individual column widths, fixed/flexible grid rules, sticky start/end behavior, horizontal scroll, responsive breakpoints and current pinned columns **exactly as implemented**. Do not standardize grids, rebalance columns, change scroll thresholds or introduce a new universal width cap. Preserve existing D20/D21/D23 behavior. The approved 44px resource-list header is a **height/color change only**; panel-table headers remain distinct.

Table variants differ in their data, filters, optional columns, icons and valid detail destinations. Their **concrete column names/counts, resource-specific actions, routing targets, helper copy and screen-level exceptions are outside this reusable pattern specification**. Preserve existing product behavior unless a reviewed screen-level ticket authorizes a change.

## 6. States & Responsive Behavior

Differentiate initial loading, true zero data, filtered/no-results, fetch error and missing cell values; UI-06 owns their meanings and feedback. Do not render an empty state before loading resolves. Preserve accessible hover/focus/touch semantics and existing horizontal scrolling. Verify that the right-pinned action column stays fixed **both with and without overflow** and does not obscure data. Do not squeeze or alter columns to make a particular screenshot fit.

## 7. Design & Implementation References

**Technical:** [`styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md), [`resource-list.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/resource-list.tsx). **Design System:** [Table/Cell](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=190-901), [Table/Head](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=190-898). These component references do not authorize altering screen-specific column sets or sizes. Individual screen references belong to internal screen reviews/tickets rather than this pattern.

## 8. Verification Criteria

- [ ] The primary Create/Add action remains beside the list title at every breakpoint; filters may wrap independently without relocating the action (D19).
- [ ] Cursor-backed lists preserve `LoadMore` with no fabricated page numbers or total counts; the control tracks the actual next-page response (D5).
- [ ] Change only the **resource-list** header from 56px/`foreground` to **44px/`muted-foreground`**; retain 56px body rows, existing insets, typography and unrelated panel heads.
- [ ] Existing tables and every column retain current widths, grids, scrolling, pinned behavior and breakpoints (D20/D21/D23).
- [ ] Every existing row-action menu stays in the **right-pinned column**, including when no overflow is visible; no new menus are fabricated.
- [ ] Navigable rows require valid destinations; nested controls, real links, Copy, selection, keyboard, modifier keys and touch remain independent and accessible.
- [ ] Configuration-directory icon treatment differs from meaningful resource icons; existing 16px/1.5-stroke role and secondary icons preserved.
- [ ] Configurable-column tables expose the labelled toolbar control where that feature is applicable; schema/API/permission details reviewed with engineering.
- [ ] No screen-specific column list, route decision, CLI footer or helper copy is asserted by this shared specification; later polishing tickets cover those separately.
