# ZITADEL NextGen: Voice

**Status:** Draft for review · 25 November 2026  
**Scope:** How the existing ZITADEL brand voice applies to NextGen marketing, product interfaces and technical documentation. This is a routing and application guide, not a new brand definition.

## Sources of truth

The [Company OS brand voice](https://github.com/zitadel/company-os/blob/main/skills/zitadel-brand-voice/SKILL.md) remains the authority for brand identity, tone and marketing strategy. Load its [product context](https://github.com/zitadel/company-os/blob/main/strategy/context/nextgen.md) for NextGen; the repository's [README](../../../README.md) and [VISION](../../../VISION.md) take precedence on what has shipped, as specified by that context. Follow Company OS naming and positioning decisions.

The brand voice describes five qualities: **Playful & Fresh**, **Friendly Authority**, **Young & Innovative**, **Mass Appeal**, and **Expressive & Rebellious**. They remain unchanged. Their expression depends on the reader's task: a campaign can challenge convention; a confirmation dialog should communicate consequences without distraction.

## Which guidance to read

| The task is about | Read |
| --- | --- |
| Website, landing page, launch post, blog, social copy, video scripts | Company OS brand voice and product context, then [marketing.md](marketing.md) |
| Console, login component, CLI prompts and output, interface errors | [product.md](product.md), then the relevant surface's implementation rules |
| Documentation, tutorials, concepts, SDK guides, API and CLI reference | [Technical writing rules](../../../apps/docs/AGENTS.md#writing) and the relevant API or CLI source rules |

For mixed content, apply the guidance to each part according to its purpose. A marketing page can embed actual CLI output without rewriting that output in a marketing tone.

## Shared writing principles

These are applications of the existing Company OS and NextGen guidance, not replacements for the brand attributes.

- **Developer to developer:** Speak as a peer. Do not assume every reader already understands authentication or Zitadel.
- **Direct and specific:** Name the action, behaviour, limit or outcome. Preserve commands and identifiers exactly.
- **Truthful:** Distinguish what is available from what is planned. Explain failure and recovery where relevant.
- **Claims backed by proof:** Support factual product promises with appropriate evidence. The format and placement depend on the medium; evidence need not precede the claim.
- **Consistent terminology:** Use the [glossary](../glossary.md) for domain concepts and the [technical writing terms](../../../apps/docs/AGENTS.md#terms) where applicable. Do not silently resolve conflicts by inventing a new term.

## One voice, three writing disciplines

| | Marketing | Product | Technical documentation |
| --- | --- | --- | --- |
| Reader's task | Evaluate or discover | Complete an action | Understand, integrate or troubleshoot |
| Tone | Expressive, approachable, confident | Neutral, clear, respectful | Direct, concrete, neutral |
| Detail | As the story and medium require | Enough to act safely and confidently | Enough to understand and complete the task |
| Example | Stop juggling auth providers. | Request to join Acme | Enable passkeys |

Technical documentation already has a detailed writing standard in `apps/docs/AGENTS.md`. Do not duplicate it here. Its guidance on plain language, concise sentences, outcome-led headings, precise terminology and recovery from failure also informs product writing where appropriate.

## Decision boundaries

- Company OS owns brand positioning and voice; the guides here apply it to NextGen. Do not change the Company OS skill as part of this proposal.
- Existing technical contracts, security requirements, approved design decisions and scoped agent instructions remain authoritative in their respective areas.
- Proposed product labels and new copy conventions require Design/Product review before implementation.
- Resolve conflicts explicitly with the relevant owners. Keep one home per fact and link to it elsewhere.

## Review

Confirm the application of the Company OS voice across the three disciplines, the proposed product-copy conventions, and any remaining terminology conflicts. Confirm launch wording and commands against the relevant sources before publication.

**Workflow:** Draft → Design Review → Approved Specification → Documentation PR → Claude Audit → Implementation.
