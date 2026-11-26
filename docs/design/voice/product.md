# Voice guide: writing for the product

**Scope:** Shared UX writing for the console, login component, CLI prompts and output, and interface error messages. Technical documentation follows [the existing writing rules](../../../apps/docs/AGENTS.md#writing). This document defines wording principles, not page layouts or application behavior. Read [`README.md`](README.md) first: it routes to the existing brand voice and relevant surface guidance. For website and launch copy, use [`marketing.md`](marketing.md).  
**Basis:** The voice principles, the metaphor decision (§2) and the [glossary](../glossary.md) (**LOCKED** entries). Exact new product-copy choices identified as **Proposed** require design/product approval before becoming implementation requirements. Until approved, keep the existing copy and do not introduce **Proposed** strings.

## Do / Don't — acceptance checklist

- [ ] The action label matches the actual action and uses the locked vocabulary.
- [ ] Copy is brief, neutral, task-focused and free of distracting marketing metaphors.
- [ ] Command and identifier formatting follows shared typography rules.
- [ ] Empty, not-configured, not-linked, unavailable, and failed-to-load states are not conflated.
- [ ] API error handling preserves the verbatim returned message required by ADR 030.
- [ ] Destructive actions explain their consequences; accessible names are meaningful.
- [ ] Existing localized versions and the relevant screen designs have been checked.

- [ ] Do not introduce Proposed strings or unconfirmed terminology before approval.
- [ ] Do not override scoped implementation rules or technical contracts.

## 1. What product writing adds to the voice

"The manifest" refers to the internal design principles for the CLI onboarding dialogue: brief, honest, transparent, no marketing language.

| Principle | What it means on screen | Source |
| --- | --- | --- |
| **Functional, not poetic** | Name actions plainly: *claim*, *join*, *create*. No “make it yours” or “graduation”. | Metaphor decision; manifest: “no marketing language” |
| **Brief** | Use the fewest words that communicate the meaning. Many screens need only a label and one line; add context only to explain a decision, requirement, limitation or consequence. | Manifest: “brief” |
| **Transparent, not explanatory** | Say what an action does and what matters to the user. Do not narrate internal mechanics or approval processes unless relevant to the decision or its consequences. | Manifest: transparency over surprise |
| **Honest on failure** | Explain what happened and, a verified recovery action if one exists. Never alarm or blame. | Manifest: “honest” |
| **Neutral** | Prioritize the task over brand expression. Avoid decorative metaphors or wit that obscures the action. | Follows from the job of the text, see `README.md` |

## 2. The metaphor decision and what it rules out

**Chosen direction:** Functional / neutral language using verbs such as **claim**, **attach**, **join**, and **create**, when they accurately describe the action.

**Scope of the decision.** It applies to product copy. An image that explains a capability is allowed in marketing copy, see [`marketing.md`](marketing.md).

**Do not use:**

- Decorative ownership or possession framing such as “make it yours”, “belongs to you”, or “your very own” that obscures an interface action. Describe actual ownership or permission semantics accurately. The approved marketing promise is not affected.
- “Graduation, not migration” as interface copy. It may remain a design intention, but not user-facing wording.
- Reassurance paragraphs such as “everything is preserved” or “nothing breaks” when the user does not need that explanation. **Exception:** An actual destructive or consequential action must state its consequences truthfully.
- Marketing language, congratulatory tone, filler explanations, or exclamation marks.

## 3. Rules of thumb

- **Action labels:** Describe the actual result: **Request to join Acme**, not a vague **Continue** when the action submits a join request.
- **Keep it short:** Remove text that merely narrates how the system works internally.
- **Body text:** Usually one short line is enough; often no body text is necessary.
- **Technical formatting:** Use monospace for commands and identifiers such as `project-river-8421` and `npx zitadel claim`. Preserve the actual identifier; visual truncation must not change its copied value.
- **Errors:** State the problem and a useful next action, without “Oops”, apologies, blame, or alarm. See the API-error constraint in §6.
- **Punctuation:** Avoid exclamation marks in routine interface copy; preserve required verbatim output.
- **One concept, one term:** Align button labels, status text, tooltips, empty states, and documentation with the glossary.
- **Truth first:** Do not describe a user, connection, policy, release, or deployment as active, linked, available, or configured without evidence.

## 4. Terminology & state language

### Locked product vocabulary

Use the existing [canonical glossary](../glossary.md) for domain terms, including **project**, **team**, **user**, **claim**, and **issuer**, respecting the status of each entry. **Dashboard** and **personal team** require terminology confirmation; this guide does not establish new glossary entries. See open decision 3. Until confirmed, use the term the current UI already shows and do not introduce new variants.

### Describe the actual state, not just the absence of a value

Different states are **not** interchangeable:

| Meaning | Wording guidance | Example or review status |
| --- | --- | --- |
| An authentication method has not been set up | Use one consistent expression across equivalent setup states. | **Proposed:** `Not configured` for password and passkey when genuinely unconfigured. Not yet approved as universal product copy. |
| A relationship between two entities is absent | Describe the missing relationship, not missing configuration. | **Proposed:** `None linked` for identity providers when no provider is linked to this user. |
| Data could not be retrieved | Distinguish a load/permission failure from a real empty state. | Existing example: `Could not be loaded`. Never replace with `Not configured`. |
| A collection contains no items | Describe the empty collection plainly; add an action only if the user can perform it to populate the collection. | Example: `No users yet.` |
| A filter returns no matches | Explain that filters, not the underlying collection, produced the empty result. | Example: `No users match this filter.` |
| Status is unknown | Do not imply a successful read or an affirmative state. | **TBD:** Choose an honest context-specific label and behavior. |

**Decision boundary:** `Not configured` and `None linked` are **proposals** for the User detail Authentication screen. They must not be applied across the product automatically until approved. The semantics above are the general rule; specific copy can differ where the underlying states differ.

## 5. Action labels, navigation & supporting copy

Apply the relevant lessons from [Technical Writing](../../../apps/docs/AGENTS.md#writing): use plain language, short sentences, sentence case for headings, outcome-led task wording, precise terms and concrete recovery steps. Explain unfamiliar concepts when the task requires it, without repeating documentation in the UI. These are proposed UX-writing applications of the existing docs standard; do not apply its procedural imperative to interactive CLI questions or override established component conventions.

- Prefer **verb + object** for actions when the object is not otherwise clear: `Add user`, `Create project`, `View user`, `Replace invitation`.
- Match labels to actual behavior. A link that opens a User detail should not imply editing; a destructive action must name the action and explain meaningful consequences.
- Keep a single term for the same action across equivalent actions in menus and screens. Refer to [UI-02](../console/ui-patterns/02-links-and-actions.md) for interaction-pattern naming.
- Avoid redundant headings, subtitles, and helper paragraphs. Keep helper text when it materially helps users complete the field or understand a limitation.
- Copy controls should have accessible labels that identify the copied content; use the existing shared feedback pattern for success.

**Screen-level proposals, not global mandates:** Change Users `Add` to `Add user` and `View details` to `View user` only after checking shared action naming and the current screen flows. Do not rename unrelated actions based on these examples alone.

## 6. Errors, confirmations & implementation constraints

- **API errors:** Respect the existing technical baseline and [ADR 030](../../adrs/030-error-model-mapping-and-reporting.md): show the **verbatim returned API response-body error message** where required. Do not replace or silently paraphrase it for voice consistency. Surrounding UI guidance may provide a next step if this does not alter the actual error.
- **Missing data vs failure:** Empty, unconfigured, not linked, inaccessible, and failed-to-load states have different meanings and must stay distinct.
- **Confirmation copy:** State the concrete action and irreversible consequences if the operation is irreversible; avoid generic “Are you sure?” as the only explanation.
- **Loading:** Only claim progress while a request is actually running. Do not display success before the operation completes.
- **Security-sensitive copy:** Do not disclose whether an account exists when the authentication journey intentionally avoids account enumeration.
- **Localization:** Translate the **meaning and domain terminology**, not just literal English wording. Do not introduce inconsistent terms across languages. Exact translations belong to a localization review, not this guideline.
- **Accessibility:** Visible labels and accessible names must be consistent; an icon-only action still needs a descriptive accessible name.

## 7. Relationship to UI Pattern specifications and the CLI

This is the **canonical cross-pattern writing guidance**. Do not duplicate it in screen tickets. Reference it wherever a UI pattern or screen requires copy decisions:

- **[UI-02 · Links & Actions](../console/ui-patterns/02-links-and-actions.md):** Action labels, accessible names, and link wording.
- **[UI-03 · Typography & Formatting](../console/ui-patterns/03-typography-and-formatting.md):** Formatting of commands, identifiers, and other technical content.
- **[UI-06 · Feedback & States](../console/ui-patterns/06-feedback-and-states.md):** Error messages, state semantics, empty/loading/success copy.
- **[UI-07 · Forms & Dialogs](../console/ui-patterns/07-forms-and-dialogs.md):** Field labels, optional markers, helper text, and confirmation language.
- **Screen tickets:** Only document the **specific wording change and its context**, then link here for the shared rule.

This guide does **not** replace valid technical requirements from [`apps/console/docs/styling.md`](../../../apps/console/docs/styling.md), the [glossary](../glossary.md), or approved screen-level design decisions. If sources conflict, record the conflict and resolve it explicitly rather than silently rewriting existing behavior.

**CLI wording** is specified where it is implemented: [`apps/cli/AGENTS.md`](../../../apps/cli/AGENTS.md) and [`apps/cli/docs/styling.md`](../../../apps/cli/docs/styling.md). Those files are canonical for prompts, hints, refusals, and output layout. This guide does not repeat them. The rules agree: a prompt is a polite question to a person ("What is the client ID of your Google OAuth app?", not "Enter the client ID"), the result comes first, and a raw system error is never printed.

## 8. Open decisions

**Open for Design/Product review (not FE implementation instructions yet):**

1. Approve or revise exact Authentication-state copy: `Not configured` (password/passkey) versus `None linked` (identity providers).
2. Confirm the shared naming convention for resource menu actions such as `View user` versus `View details`.
3. Confirm **dashboard** and **personal team** with the glossary owners; add entries only if approved.

