# UI-03 — Typography & Formatting

**Status:** Approved reusable design rules; engineering/documentation review still required. This is not a claim that code, Figma or `styling.md` has been updated.  
**Technical baseline:** [`apps/console/docs/styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). Preserve every nonconflicting technical requirement.  
**Legend:** **EXISTING** = verified technical baseline; **APPROVED** = design-approved target; **CHANGE** = approved update not yet implemented.  

## 1. Purpose & Scope

Canonical owner of shared **text roles, resource identifier presentation, dates/times, truncation, and nonredundant helper copy**. Table geometry and identity-cell contents belong to UI-01; Copy to UI-02; detail composition to UI-04; form label composition to UI-07; global shell and navigation are separate.

## 2. Anatomy

**EXISTING:** Reuse `PAGE_TITLE` display-serif 24/24, `PAGE_TITLE_ROW` 36px, `SECTION_HEADING` serif 16/20, `OVERLINE` uppercase 12/16 with 0.72px tracking, `EYEBROW` (overline + muted), `PANEL_HEAD_CELL` muted uppercase 12px and `FIELD_LABEL_TYPOGRAPHY` sans regular 14/20. These are shared roles, not an invitation to create screen-specific duplicates.

**EXISTING:** `SUBSECTION_HEADING` is exported from `typography.ts` as the shared 14/20 serif subsection role and is documented in `styling.md`. Reuse this role for headings within card bodies beneath a `SECTION_HEADING`; do not create screen-specific duplicates.

## 3. Visual Rules

**APPROVED identifier rule:** Display IDs in **12px monospace** and use **middle truncation only when constrained**, without losing the underlying value or Copy access. A full ID remains visible when it fits; no globally fixed elision character count is approved. Use layout-aware middle elision rather than accidental CSS clipping.

**APPROVED:** Keep existing Console typography scale on mobile and desktop. Fix real truncation, wrapping and alignment defects without introducing a new mobile heading scale. Keep existing panel-table typography independent of the UI-01 resource-list header change.

**APPROVED content policy:** Remove *genuinely redundant* supporting copy, not all subtitles or descriptions. Preserve meaningful guidance, form help, accessibility labels, warnings and errors. Exact copy removals are **screen-level editorial decisions**, not a blanket text-deletion rule.

## 4. Interaction Rules

**APPROVED / EXISTING:** Keep `formatRecent()`'s **24-hour boundary**: relative minutes/hours/`just now` within 24 hours, then localized **absolute date + time** via `formatDateTime()` after 24 hours. For fields semantically requiring date only, use `formatDate()`; for date and time, use the existing `formatDateTime()` / `formatRecent()` as appropriate. Preserve locale, viewer timezone, and current invalid-input fallback. **No globally new `n days ago` rule** or blanket timestamp precision change.

Full values remain available through UI-02 Copy as needed; timestamps and labels must not suggest a domain state (e.g. latest vs live) that backend data does not support (UI-06).

## 5. Variants & Exceptions

**Current code vs approved target:** `ResourceIdCell` already renders `IdText`, which middle-truncates constrained identifiers and retains the full value for Copy and tooltip. The remaining approved typography change is **12px monospace** instead of the current `text-sm`; preserve the existing layout-aware middle elision. Resource IDs, timestamps, short labels, headings, descriptive copy and table head labels have distinct roles. Use field semantics for date-only vs date-time presentation; **any bespoke screen exception is decided and documented in that screen's polishing ticket**, not in the generic pattern.

## 6. States & Responsive Behavior

Test long translated strings, constrained identifiers, safe Copy access, date formatting across locales and timezones, the 24-hour cutoff and daylight-saving transitions. Preserve keyboard/touch access and accessible focus. Truncate intentionally where required; otherwise wrap instead of clipping.

## 7. Design & Implementation References

**Technical:** [Typography implementation](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/typography.ts), [Date formatter](https://github.com/zitadel/nextgen/blob/main/apps/console/src/lib/date.ts), [`ResourceIdCell`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/resource-list.tsx), [`styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). **Design System:** [Typography](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=22-1400). Screen copy and examples belong to individual UI reviews.

## 8. Verification Criteria

- [ ] IDs render at 12px monospace, middle-truncate only when constrained, and expose the untouched source for Copy.
- [ ] Existing type role hierarchy, responsive scale, shared style tokens and distinct panel headers remain intact.
- [ ] Reuse the existing `SUBSECTION_HEADING` 14/20 role wherever a card-body subsection heading is needed, without duplicating the style.
- [ ] `formatRecent()` unchanged: relative within 24h, localized date + time thereafter; date-only fields stay date-only where appropriate.
- [ ] Remove only proven redundant supporting copy and preserve meaningful instructions/accessibility text; exact screens handled in tickets.
- [ ] Check long copy/identifiers and date formatting on desktop, mobile, keyboard, and both themes.
