# UI-05 — Visual Consistency

**Status:** Approved reusable design rules; engineering/documentation review still required. This is not a claim that code, Figma or `styling.md` has been updated.  
**Technical baseline:** [`apps/console/docs/styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md). Preserve every nonconflicting technical requirement.  
**Legend:** **EXISTING** = verified technical baseline; **APPROVED** = design-approved target; **CHANGE** = approved update not yet implemented.  

## 1. Purpose & Scope

Canonical owner of **shared tokens, component surfaces/radii, role-specific icon styling and light/dark visual parity**. UI-01 owns table icon *eligibility* and header geometry; UI-06 owns semantic statuses; global Page Layout & Navigation (including retained widths/canvas) remain separate. This pattern does not introduce a new visual language.

## 2. Anatomy

**EXISTING:** The Console uses shadcn/ui primitives from `src/components/ui/`, the configured `new-york`/Radix registry track, generated `--zl-*` design tokens exposed through semantic Tailwind utilities, and the existing theme switch. `src/styles.css` holds global imports/themes, not component-scoped rules. Inventory before building: existing local primitive → compatible shadcn registry primitive → single shared custom component only if needed. Do not silently mix the Base UI and Radix tracks or duplicate variants per screen.

## 3. Visual Rules

**APPROVED:** Preserve existing Design System **Card border and elevation variants**, rather than adding a blanket border, borderless treatment or shadow recipe. Preserve `rounded-md` **8px** on Console cards, tables, panels, dialogs, drawers, alerts and tab strips. Use semantic tokens (`background`, `card`, `foreground`, `muted-foreground`, `border`, `ring`, `destructive`) instead of new hardcoded CSS. **EXISTING token results:** light canvas `#fafafa`, elevated Card `#ffffff`; dark canvas `#050505`, Cards `#121212`. These are baseline values, not hardcoded implementation instructions.

**Icons:** Preserve the icon size/stroke of each **actual component role**; existing resource-row icons are 16px with 1.5 stroke. Do not apply a stroke from an isolated mock globally, remove meaningful icons from secondary cells or introduce new decorative icon usage. Configuration-directory primary-name icon eligibility is defined only in UI-01. Copy and action-icon details follow UI-02.

## 4. Interaction Rules

Shared components supply their own true hover, focus, active, invalid and disabled variants. Noninteractive text/status badges remain noninteractive; do not invent badge pointer/focus behavior. Row, link and pending semantics are owned by UI-01, UI-02 and UI-06 respectively.

## 5. Variants & Exceptions

Use existing Card, Button, Badge and panel variants when they match the intended semantics; implement component-wide corrections once at their shared source. Keep resource-list table heads and panel table heads distinct (UI-01). **Approved global boundary:** Keep existing individual content widths and the current canvas/card contrast. Do not introduce a universal width or an extra dark-mode content shade. Screen-specific exceptions must be approved within their own product reviews rather than becoming global component variants by accident.

## 6. States & Responsive Behavior

Validate tokens and contrast in light/dark at rest, hover, focus, disabled and invalid. Preserve focus-visible, legible long content and meaningful touch targets across existing breakpoints. When a screen mock disagrees with a verified Design System master, verify the component's intended semantic variant rather than copying WIP styling.

## 7. Design & Implementation References

**Technical:** [`styling.md`](https://github.com/zitadel/nextgen/blob/main/apps/console/docs/styling.md), [`ui/button.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/ui/button.tsx), [`ui/badge.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/ui/badge.tsx), [`resource-list.tsx`](https://github.com/zitadel/nextgen/blob/main/apps/console/src/components/resource-list.tsx). **Design System:** [Card](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=21123-292666), [Button](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=37-931), [Badge](https://www.figma.com/design/HToNyqKwShDmqVurU7Xbld/?node-id=21828-827). Product-screen examples remain separate from reusable component references.

## 8. Verification Criteria

- [ ] Use semantic tokens, installed component track and shared variants; no one-off CSS forks, hardcoded new colors or radius changes.
- [ ] Existing Card surfaces/borders and `rounded-md` 8px behavior remain; current light/dark canvas contrast unchanged.
- [ ] Icon sizing and stroke remain role-specific; resource-row 16px/1.5 applies only to that role.
- [ ] Only UI-01 modifies the resource-list head variant; panel heads remain intact.
- [ ] Focus, contrast, responsive wrapping and interactive component variants checked in both themes.
- [ ] No unrelated table sizing, global page layout or navigation changes introduced by visual consistency work.
