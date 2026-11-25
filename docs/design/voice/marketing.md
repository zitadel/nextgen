# ZITADEL NextGen: Writing for marketing

**Status:** Draft for the messaging workshop · 25 November 2026  
**Scope:** Website, landing pages, launch posts, blog, social copy, video scripts and on-screen text in videos. Read [`README.md`](README.md) first: the voice defined there applies here in full. For text inside the product, use [`product.md`](product.md).

## 1. What marketing writing adds to the voice

| Principle | What it means on the page | Source |
| --- | --- | --- |
| **Take a position** | Say what ZITADEL is an alternative to: the complexity of legacy identity tools and vendor lock-in. Name the problem the reader has. | `skills/zitadel-brand-voice` (expressive, rebellious); `company.md` |
| **Wit that explains** | One sharp image is welcome when it makes a capability clear in a few words. | `positioning.md` |
| **Start with the problem or the command** | Never start with the company. | `skills/zitadel-brand-voice` |
| **Claim, then proof, on the same screen** | A headline is followed by the command, the output, or a real screen. | `company.md`; `content-channel-strategy.md` |
| **Label what is not there yet** | Planned capabilities may appear, marked "Coming soon" at the feature, not as a banner over the whole page. | `marketing/website-launch-strategy.md` |

## 2. Examples

| Write | Not | Why |
| --- | --- | --- |
| "Stop juggling auth providers." | "The seamless, robust identity platform." | Names the reader's problem. No judgment words. |
| "Give your AI a passport and a leash." | "Next-generation AI agent security." | The image explains identity plus limits. |
| `npx @zitadel/cli@latest start` with "No account needed" | "Get started in minutes." | The command is the proof. The flag is a checkable fact. |
| "Agent governance. Coming soon." | Describing a planned capability as available | Honest about the current state. |

The first two lines are taken from `strategy/positioning.md`.

## 3. Images and metaphors

- Allowed: an image that explains what a capability does ("a passport and a leash" for agent identity with limits).
- Not allowed: an image that only makes something sound better, or one that needs explaining itself.
- One image per section at most. The line after it is plain.

## 4. Calls to action

In priority order (`skills/zitadel-brand-voice`): the command, "Sign up", "Book a call" for enterprise, "Join our community", "Read the docs". The primary call to action is a command, not a button.

## 5. Tone by reader

The voice stays the same. On pages written for one audience, the emphasis shifts (`strategy/messaging-matrix.md`): practical for Davide, blunt for John, technical and specific for Amir, risk-aware for Sarah.

## 6. Checklist

- [ ] The page starts with the reader's problem or the command, not with ZITADEL.
- [ ] Every claim is followed by a command, an output, or a real screen.
- [ ] No judgment words (fast, easy, powerful) and none of the banned words in `README.md`.
- [ ] Any image explains a capability.
- [ ] Capabilities that are not available are labelled "Coming soon".
- [ ] Product terms match the [glossary](../glossary.md).

## 7. Open decisions

1. The hero line for the launch. `positioning.md` sets "Authenticate Humans. Govern Agents. Secure Everything." Only the first part is available today.
2. Whether the product promise "You own the experience. Zitadel guards the state." is used in marketing copy. See open decision 3 in `README.md`.
