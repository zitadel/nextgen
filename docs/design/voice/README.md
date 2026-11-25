# ZITADEL NextGen: Voice

**Status:** Draft for the messaging workshop · 25 November 2026  
**Scope:** How ZITADEL NextGen sounds, wherever it speaks. This file holds what is shared. Two further files hold the rules for the two kinds of writing.

## Which file to read

| The task is about | Read |
| --- | --- |
| Website, landing page, launch post, blog, social copy, video scripts | this file, then [`marketing.md`](marketing.md) |
| Console, hosted login, CLI output, error messages, docs | this file, then [`product.md`](product.md) |

**For coding agents:** decide first which of the two the task belongs to. If the text appears inside the product or the docs, it is product writing. If it appears on a page whose job is to make someone try ZITADEL, it is marketing writing. Do not mix the two sets of rules. If a task covers both (for example a landing page that embeds real CLI output), apply `marketing.md` to the page copy and `product.md` to the embedded output.

## The voice

One voice in both kinds of writing: a developer talking to another developer.

| Principle | What it means | Source |
| --- | --- | --- |
| **Developer to developer** | Peer to peer. Written like a senior engineer for other engineers. Commands and identifiers in monospace. | `create-first-claim-later.md`; `company.md` |
| **Direct and specific** | Say what it does. Name the thing, the command, the number. | `company.md` |
| **Calm** | No exclamation marks, no praise, no artificial urgency. | `create-first-claim-later.md` |
| **Honest** | State limitations and failures plainly. Label what is not available yet. | `create-first-claim-later.md`; `gtm-strategy.md` |
| **Proof before claim** | Show the command, the output, or the state. No words that pass judgment (fast, easy, powerful). Words that state a checkable fact are fine: open source, self-hosted, no account needed. | **Proposed.** Based on `company.md` (say what it does, with a concrete example or command) and [`apps/website/AGENTS.md`](../../../apps/website/AGENTS.md) (the front page says the benefit, then proves it) |
| **One term per concept** | Use the term from the [glossary](../glossary.md) everywhere. Never rename a domain entity. | Locked product glossary |

## Marketing and product writing compared

| | Marketing | Product |
| --- | --- | --- |
| Where | Website, landing page, launch posts, videos | Console, hosted login, CLI, error messages, docs |
| The reader | Has not decided yet | Wants to get a task done |
| Job of the text | Give a reason to try it | Stay out of the way |
| Attitude | Rebellious. Takes a position against legacy identity tools. | Neutral |
| Images | Allowed when they explain: "a passport and a leash" | None. The label is the action. |
| Length | One line with a point, then the proof | As short as possible, often only a label |
| Example | "Stop juggling auth providers." | "Request to join Acme" |

## Never, in either kind of writing

- "seamless", "robust", "best-in-class", "next-generation", "powerful yet simple", "excited to share", "thrilled to announce" (`skills/zitadel-brand-voice`).
- "We rebuilt Zitadel from scratch", "the new Zitadel", "v5" or any version framing, and "migration required" without an immediate explanation of the path (`strategy/gtm-strategy.md`).
- Exclamation marks, "Great!", "Oops".

## Sources

The file names above refer to the Company OS (`zitadel/company-os`): `strategy/context/company.md`, `strategy/create-first-claim-later.md` (CLI Onboarding Flow, Design Principles), `strategy/gtm-strategy.md`, `strategy/positioning.md`, `skills/zitadel-brand-voice/SKILL.md`.

## Open decisions for the workshop

1. Approve the split into one voice and two kinds of writing.
2. Approve "Proof before claim" as a shared principle.
3. **Ownership wording.** `product.md` rules out ownership framing in the interface ("make it yours", "belongs to you"). The documented product promise is "You own the experience. Zitadel guards the state." (`strategy/context/nextgen.md`). Decide whether the promise is allowed in marketing copy as written.
4. **Commands.** Confirm the canonical commands before any surface prints them. Sources currently show `npx @zitadel/cli@latest start`, `npx @zitadel/cli setup`, and `npx zitadel claim`.
5. Update `skills/zitadel-brand-voice` in the Company OS to point to these files once they are approved. Its value proposition, one-liner, and audience still describe the current ZITADEL (B2B multi-tenancy).

**Workflow:** Draft → Design Review → Approved Specification → Documentation PR → Claude Audit → Implementation.
