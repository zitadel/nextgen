# ZITADEL NextGen: Writing for the product

**Status:** Working FE handoff · 4 November 2026 · restructured 25 November 2026  
**Scope:** Shared UX writing for the NextGen Console, hosted login, CLI output, error messages, and docs. This document defines wording principles, not page layouts or application behavior. Read [`README.md`](README.md) first: the voice defined there applies here in full. For website and launch copy, use [`marketing.md`](marketing.md).  
**Basis:** The voice principles, metaphor decision, and locked glossary supplied by Design. Exact new product-copy choices identified as **Proposed** require design/product approval before becoming implementation requirements.

## 1. What product writing adds to the voice

"The manifest" is the CLI Onboarding Flow dialogue script in the Company OS (`strategy/create-first-claim-later.md`, Design Principles).

| Principle | What it means on screen | Source |
| --- | --- | --- |
| **Functional, not poetic** | Name actions plainly: *claim*, *join*, *create*. No “make it yours” or “graduation”. | Metaphor decision; manifest: “no marketing language” |
| **Brief** | Use the fewest words that communicate the meaning. Many screens need only a label and one line. | Manifest: “brief” |
| **Transparent, not explanatory** | Say what an action does and what matters to the user. Do not narrate internal mechanics or approval processes unless relevant to the decision or its consequences. | Manifest: transparency over surprise |
| **Honest on failure** | Explain what happened and, where possible, what the user can do next. Never alarm or blame. | Manifest: “honest” |
| **Neutral** | No position, no wit, no images. The reader is in the middle of a task. | Follows from the job of the text, see `README.md` |

## 2. The metaphor decision and what it rules out

**Chosen direction:** Functional / neutral language using verbs such as **claim**, **attach**, **join**, and **create**, when they accurately describe the action.

**Scope of the decision.** It applies to product copy. An image that explains a capability is allowed in marketing copy, see [`marketing.md`](marketing.md).

**Do not use:**

- Ownership or possession framing such as “make it yours”, “belongs to you”, or “your very own”.
- “Graduation, not migration” as interface copy. It may remain a design intention, but not user-facing wording.
- Reassurance paragraphs such as “everything is preserved” or “nothing breaks” when the user does not need that explanation. **Exception:** An actual destructive or consequential action must state its consequences truthfully.
- Marketing language, congratulatory tone, filler explanations, or exclamation marks.

## 3. Rules of thumb

- **Action labels:** Describe the actual result: **Request to join Acme**, not a vague **Continue** when the action submits a join request.
- **Keep it short:** Remove text that merely narrates how the system works internally.
- **Body text:** Usually one short line is enough; often no body text is necessary.
- **Technical formatting:** Use monospace for commands and identifiers such as `project-river-8421` and `npx zitadel claim`. Preserve the actual identifier; visual truncation must not change its copied value.
- **Errors:** State the problem and a useful next action, without “Oops”, apologies, blame, or alarm. See the API-error constraint in §6.
- **Punctuation:** Never use exclamation marks.
- **One concept, one term:** Align button labels, status text, tooltips, empty states, and documentation with the glossary.
- **Truth first:** Do not describe a user, connection, policy, release, or deployment as active, linked, available, or configured without evidence.

## 4. Terminology & state language

### Locked product vocabulary

Use the existing canonical glossary for **project**, **team**, **user**, **claim**, **issuer**, **dashboard**, and **personal team**. These terms are **locked**; this document does not redefine their meanings. **Canonical glossary:** [`docs/design/glossary.md`](../glossary.md). It defines project, team, user, claim, and issuer. It does not yet contain entries for **dashboard** or **personal team**. See open decision 3.

### Describe the actual state, not just the absence of a value

Different states are **not** interchangeable:

| Meaning | Wording guidance | Example or review status |
| --- | --- | --- |
| An authentication method has not been set up | Use one consistent expression across equivalent setup states. | **Proposed:** `Not configured` for password and passkey when genuinely unconfigured. Not yet approved as universal product copy. |
| A relationship between two entities is absent | Describe the missing relationship, not missing configuration. | **Proposed:** `None linked` for identity providers when no provider is linked to this user. |
| Data could not be retrieved | Distinguish a load/permission failure from a real empty state. | Existing example: `Could not be loaded`. Never replace with `Not configured`. |
| A collection contains no items | Describe the empty collection plainly; add an action only when meaningful. | Example: `No users yet.` |
| A filter returns no matches | Explain that filters, not the underlying collection, produced the empty result. | Example: `No users match this filter.` |
| Status is unknown | Do not imply a successful read or an affirmative state. | **TBD:** Choose an honest context-specific label and behavior. |

**Decision boundary:** `Not configured` and `None linked` are **proposals** for the User detail Authentication screen. They must not be applied across the product automatically until approved. The semantics above are the general rule; specific copy can differ where the underlying states differ.

## 5. Action labels, navigation & supporting copy

- Prefer **verb + object** for actions when the object is not otherwise clear: `Add user`, `Create project`, `View user`, `Replace invitation`.
- Match labels to actual behavior. A link that opens a User detail should not imply editing; a destructive action must name the action and explain meaningful consequences.
- Keep a single term for the same action across menus and screens. A **Row Actions Menu** is the vertical ellipsis menu belonging to one row; a **Columns** control configures visible table columns. These are distinct controls.
- Avoid redundant headings, subtitles, and helper paragraphs. Keep helper text when it materially helps users complete the field or understand a limitation.
- Copy controls should have accessible labels that identify the copied content; use the existing shared feedback pattern for success.

**Screen-level proposals, not global mandates:** Change Users `Add` to `Add user` and `View details` to `View user` only after checking shared action naming and the current screen flows. Do not rename unrelated actions based on these examples alone.

## 6. Errors, confirmations & implementation constraints

- **API errors:** Respect the existing technical baseline and ADR 030: show the **verbatim returned API response-body error message** where required. Do not replace or silently paraphrase it for voice consistency. Surrounding UI guidance may provide a next step if this does not alter the actual error.
- **Missing data vs failure:** Empty, unconfigured, not linked, inaccessible, and failed-to-load states have different meanings and must stay distinct.
- **Confirmation copy:** State the concrete action and irreversible consequences where applicable; avoid generic “Are you sure?” as the only explanation.
- **Loading:** Only claim progress while a request is actually running. Do not display success before the operation completes.
- **Security-sensitive copy:** Do not disclose whether an account exists when the authentication journey intentionally avoids account enumeration.
- **Localization:** Translate the **meaning and domain terminology**, not just literal English wording. Do not introduce inconsistent terms across languages. Exact translations belong to a localization review, not this guideline.
- **Accessibility:** Visible labels and accessible names must be consistent; an icon-only action still needs a descriptive accessible name.

## 7. Relationship to UI Pattern specifications and the CLI

This is the **canonical cross-pattern writing guidance**. Do not duplicate it in screen tickets. Reference it wherever a UI pattern or screen requires copy decisions:

- **UI-02 · Links & Actions:** Action labels, accessible names, and link wording.
- **UI-03 · Typography & Formatting:** Formatting of commands, identifiers, and other technical content.
- **UI-06 · Feedback & States:** Error messages, state semantics, empty/loading/success copy.
- **UI-07 · Forms & Dialogs:** Field labels, optional markers, helper text, and confirmation language.
- **Screen tickets:** Only document the **specific wording change and its context**, then link here for the shared rule.

This guide does **not** replace valid technical requirements from `apps/console/docs/styling.md`, the locked glossary, or approved screen-level design decisions. If sources conflict, record the conflict and resolve it explicitly rather than silently rewriting existing behavior.

**CLI wording** is specified where it is implemented: [`apps/cli/AGENTS.md`](../../../apps/cli/AGENTS.md) and [`apps/cli/docs/styling.md`](../../../apps/cli/docs/styling.md). Those files are canonical for prompts, hints, refusals, and output layout. This guide does not repeat them. The rules agree: a prompt is a polite question to a person ("What is the client ID of your Google OAuth app?", not "Enter the client ID"), the result comes first, and a raw system error is never printed.

## 8. FE acceptance checklist & open decisions

- [ ] The action label matches the actual action and uses the locked vocabulary.
- [ ] Copy is brief, neutral, and free of marketing metaphors or exclamation marks.
- [ ] Command and identifier formatting follows shared typography rules.
- [ ] Empty, not-configured, not-linked, unavailable, and failed-to-load states are not conflated.
- [ ] API error handling preserves the verbatim returned message required by ADR 030.
- [ ] Destructive actions explain their consequences; accessible names are meaningful.
- [ ] Existing localized versions and the relevant screen designs have been checked.

**Open for Design/Product review (not FE implementation instructions yet):**

1. Approve or revise exact Authentication-state copy: `Not configured` (password/passkey) versus `None linked` (identity providers).
2. Confirm the shared naming convention for resource menu actions such as `View user` versus `View details`.
3. Add **dashboard** and **personal team** to `docs/design/glossary.md`, or remove them from the locked list in §4.

**Workflow:** Draft → Design Review → Approved Specification → Documentation PR → Claude Audit → Implementation.
