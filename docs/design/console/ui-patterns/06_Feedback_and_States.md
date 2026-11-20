# UI-06 — Feedback & States

**Status:** Approved reusable design rules; engineering/documentation review still required. This is not a claim that code, Figma or `styling.md` has been updated.  
**Technical baseline:** [`apps/console/docs/styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). Preserve every nonconflicting technical requirement.  
**Legend:** **EXISTING** = verified technical baseline; **APPROVED** = design-approved target; **CHANGE** = approved update not yet implemented.  

## 1. Purpose & Scope

Canonical owner of **loading, empty, filtered-empty, error, success, mutation pending and passive business-status feedback**. Generic state meanings are shared; screen copy, individual status-to-API mappings and particular error illustrations belong to screen-level polishing tickets. Link/copy actions belong to UI-02; forms and validation to UI-07; theme tokens to UI-05.

## 2. Anatomy

**EXISTING:** Use `ResourceEmptyRow` for list-empty presentation, `FormError` for mutation errors, `Button loading`/`useSubmit` for pending submissions, `LoadMore` for pagination, and the existing Alert, Empty, Badge and Sonner components where applicable. Preserve ADR 030's API error behavior: show the actual returned server message where appropriate, not an invented transport message; preserve readable multiline wrapping.

## 3. Visual Rules

**APPROVED passive status:** Use existing Badge variants and semantic colors according to actual backend meaning; do not introduce a new global badge palette or interactive hover for passive status labels. Domain labels like `Active`, `Inactive`, `Blocked`, `Latest`, `In use` and `Live` are not interchangeable: **never imply latest = currently deployed/live**. Specific product terminology and mapping to API states are **not defined by this generic pattern**.

**APPROVED empty states:** A genuinely empty collection uses an informative state with a relevant discoverable CTA (in the state or already in its visible toolbar). A filter/search with zero matches uses a **compact no-results message inside the existing table area**, not a full setup/onboarding state and not a message below the table. Offer a real reset control only when filters exist and it is meaningful; no phantom clickable row.

**APPROVED success:** Use the existing Sonner toast **or** an inline success confirmation according to the operation. Do not add a toast after every mutation, and do not signal success before the response confirms it. Reuse existing component sizes/variants; no arbitrary new duration, stacking or color rules.

## 4. Interaction Rules

**APPROVED pending/loading:** Show transient action loading **only while the operation is actually in flight** and prevent duplicate invocation. On completion, present confirmed success, truthful error or intended navigation; do not retain a stale faux-Pending button confirmation. A **persistent business state** called `Pending` remains visible as long as the backend reports it (e.g. an invitation or approval) and must not be confused with action loading.

Failed mutation leaves the relevant context/input intact, explains the error and allows correction/retry where supported. Copy confirmation follows UI-02, not a second independent toast rule.

## 5. Variants & Exceptions

Distinguish **initial loading**, genuine no data, filtered no matches, fetch failure, missing field values, transient mutation pending/error and persistent domain status. A resource list is not empty until the initial fetch settles. A missing read-only cell may display muted `—`; it does not imply editability. Product-specific state text, exact badge assignment and exceptions require truthful screen/API data, not invented global design decisions. Preserve existing usable shared component variants until a reviewed change authorizes a replacement.

## 6. States & Responsive Behavior

Error messages, long IDs, warnings and confirmation content must wrap without clipping in narrow layouts and remain readable with assistive technology. Keep loading, focus and status announcements accessible. Verify all meaningful states under keyboard, touch, screen reader and both themes; never silently discard input after a failed mutation.

## 7. Design & Implementation References

**Technical:** [`styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md), [`resource-list.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/resource-list.tsx), [`form-error.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/form-error.tsx), [`use-submit.ts`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/hooks/use-submit.ts). **Design System:** [Badge](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=26-169), [Empty](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=18672-1039), [Sonner](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=18482-48401), [Button Loading](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=37-931). Internal product-screen examples and future public references are maintained separately; they are not normative pattern links.

## 8. Verification Criteria

- [ ] Loading, no data, filtered no-results, fetch error, missing values, pending action and persistent status remain distinct.
- [ ] No-data CTA is meaningful; no-results is compact **inside the table area** with a valid reset control only when applicable.
- [ ] Use existing Badge visual variants for passive business states and preserve actual domain meaning, including latest/in-use/live distinctions.
- [ ] Action loading ends with the actual request; prevent duplicate submit, never claim false success, retain context on error.
- [ ] Success inline/toast is contextual, and API messages are readable with proper wrapping/announcements.
- [ ] Verify generic states in keyboard/touch/screen reader, desktop/mobile and light/dark; concrete screen-status mappings are resolved in later tickets.
