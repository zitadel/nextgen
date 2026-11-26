# Voice guide

**Scope:** How the existing Zitadel brand voice applies to marketing, product interfaces and technical documentation for the next iteration of Zitadel. This is a routing and application guide, not a new brand definition.

## Sources of truth

The internal Zitadel brand voice guide remains the authority for brand identity, tone and marketing strategy. For what has shipped, this repository's [README](../../../README.md) and [VISION](../../../VISION.md) take precedence. Follow the approved naming and positioning decisions. For the product philosophy behind configuration, runtime state and interfaces, see the [user experience principles](../user-experience-principles.md); these guides cover wording only.

The brand voice describes five qualities: **Playful & Fresh**, **Friendly Authority**, **Young & Innovative**, **Mass Appeal**, and **Expressive & Rebellious**. They remain unchanged. Their expression depends on the reader's task: a campaign can challenge convention; a confirmation dialog should communicate consequences without distraction.

If the internal brand guidance is unavailable, follow this repository's writing rules and existing approved copy. Do not invent positioning, launch claims, product names, or CTA ordering; ask the relevant owner before publishing new positioning. Factual version numbers, compatibility guidance, and versioned identifiers are permitted when required for integration or product selection.

## Which guidance to read

| The task is about | Read |
| --- | --- |
| Website, landing page, launch post, blog, social copy, video scripts | internal brand voice guide and product context, then [marketing.md](marketing.md) |
| Console, login component, CLI prompts and output, interface errors | [product.md](product.md), then the relevant surface's implementation rules |
| Documentation, tutorials, concepts, SDK guides, API and CLI reference | [Technical writing rules](../../../apps/docs/AGENTS.md#writing) and the relevant API or CLI source rules |

For mixed content, apply the guidance to each part according to its purpose. A marketing page can embed actual CLI output without rewriting that output in a marketing tone.

## Shared writing principles

These are applications of the existing brand voice and the guidance in this repository, not replacements for the brand attributes.

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

- The internal brand voice guide owns brand positioning and voice; the guides here apply it to this repository's product surfaces.
- Existing technical contracts, security requirements, approved design decisions and scoped agent instructions remain authoritative in their respective areas.
- Proposed product labels and new copy conventions require Design/Product review before implementation.
- Resolve conflicts explicitly with the relevant owners. Keep one home per fact and link to it elsewhere.

## Review

Confirm the application of the internal brand voice across the three disciplines, the proposed product-copy conventions, and any remaining terminology conflicts. Confirm launch wording and commands against the relevant sources before publication.

