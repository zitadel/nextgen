# UI-07 — Forms & Dialogs

**Status:** Approved reusable design rules; engineering/documentation review still required. This is not a claim that code, Figma or `styling.md` has been updated.  
**Technical baseline:** [`apps/console/docs/styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). Preserve every nonconflicting technical requirement.  
**Legend:** **EXISTING** = verified technical baseline; **APPROVED** = design-approved target; **CHANGE** = approved update not yet implemented.  

## 1. Purpose & Scope

Canonical owner for **form fields, labels, optional markers, helper placement, validation timing, selection primitives, creation/edit surfaces, confirmation dialogs and destructive copy**. Link/Copy belongs to UI-02, text styles to UI-03, action loading/error semantics to UI-06. Which fields, actions or forms a particular screen contains are product-specific rather than global pattern requirements.

## 2. Anatomy

**EXISTING:** Reuse the installed shadcn/Radix `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup` and related primitives. Preserve sans 14/20 form labels; `Input` height **36px**, `bg-background`, 10px horizontal padding and existing focus/invalid styling. `Select` for a nonsearchable single choice; `Combobox` (`Popover` + `Command`) for searchable single/multiple selection, without silently switching to a different component track.

For in-app Create/Edit, the established `FormSheet` pattern provides a right-side drawer (existing max 520px), 56px header, scrollable content and secondary Cancel + primary Submit. Existing `ConfirmDialog`/AlertDialog patterns handle confirmations (existing `sm` sizing about 384px). Preserve intentional inline edits and standalone authentication flows: the default is **not** permission to convert every existing UI into a drawer.

## 3. Visual Rules

**APPROVED:** Optional fields show a literal **`(optional)`** suffix; required fields are the unmarked default and do not get a global asterisk. Preserve truthful native/semantic required state. Meaningful field helper text sits **beneath the control/input**, not between label and control; omit redundant helper text. Show field validation in the field's context, and submission/server errors by the relevant action. Preserve the existing tinted, rather than solid-red, destructive Button styling and `rounded-md`/semantic tokens.

## 4. Interaction Rules

**APPROVED client validation:** Expose client errors on **blur after the user has interacted** and at **submit**, including untouched invalid fields when submitting. Once errors are visible, update them as the user corrects input. Do not produce premature errors on initial typing. API/server errors are shown only on a real response; preserve accurate message content (UI-06).

Use current `useSubmit` and Button Loading behavior to prevent repeat requests. A confirmation dialog closes **only after success**, not immediately on click or after failure. Preserve focus management, Escape/backdrop behavior, native label/error associations, keyboard/touch and permission semantics. Destructive confirmation text names the **specific action and consequence**, with an unequivocal **Cancel**, not a generic Confirm-only flow.

## 5. Variants & Exceptions

**APPROVED default:** In-app Create/Edit uses the existing FormSheet; confirmations use the established dialog/alert-dialog primitive. Deliberate inline edits and independent authentication surfaces remain valid exceptions. Do not invent backend rules or silently classify a one-off screen layout as a global form-pattern variant. The appropriate form fields, access controls and exceptional screen-specific flows are reviewed in their own UI-polishing tickets.

Form validation may have synchronous, asynchronous or server-side dependencies; their implementation details must preserve the common **error timing and presentation** rules. Use existing accessible controls/variants; a specialized workflow must not silently undo the shared optional-marker/helper conventions.

## 6. States & Responsive Behavior

Respect default, focus, invalid, disabled, loading, success and error variants; maintain accessible announcements and actual `required` semantics. Long labels, helper descriptions and errors must wrap within dialogs/sheets; don't expand viewport width or hide the primary/Cancel actions on small screens. A failure retains form data and error context; pending blocks duplicate submission.

## 7. Design & Implementation References

**Technical:** [`styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md), [`field.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/ui/field.tsx), [`input.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/ui/input.tsx), [`form-sheet.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/form-sheet.tsx), [`confirm-dialog.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/confirm-dialog.tsx), [`use-submit.ts`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/hooks/use-submit.ts). **Design System:** [Field](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=18684-15122), [Input](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=65-520), [Sheet](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=216-3314), [Dialog](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=112-477). Actual screen-specific exceptions, evidence and content belong in later product tickets.

## 8. Verification Criteria

- [ ] Use existing `Field`, Select/Combobox, FormSheet, ConfirmDialog and Button primitives; preserve dimensions, Radix track, semantics and permissions.
- [ ] Optional label = `(optional)`; required unmarked, with accurate accessible `required` behavior.
- [ ] Client errors after interacted blur or submit; exposed errors update during correction; actual server error shown only after response.
- [ ] Helper descriptions appear only where needed **beneath controls**, not as duplicated labels; errors remain readable.
- [ ] In-app Create/Edit defaults to FormSheet; confirmation uses Dialog, while legitimate inline and standalone flows remain intact.
- [ ] Destructive action and consequence explicit, Cancel clear, tinted destructive variant preserved; dialog never falsely closes on error.
- [ ] Mobile/desktop, focus, keyboard/touch and long-content checks performed; individual form exceptions reviewed in screen tickets.
