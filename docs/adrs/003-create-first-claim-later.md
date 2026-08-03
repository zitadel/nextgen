# ADR 003: Create First, Claim Later

> **Status:** Withdrawn
> **Superseded by:** [ADR 046: Claim Lifecycle v2](046-claim-lifecycle-v2.md)
> **Date:** 2026-04-26
> **Context:** AI-native Zitadel CLI onboarding

## Withdrawal

The pre-claim / claim lifecycle has been removed from the CLI and api-mock pending a server-side `claim` contract (`/projects/{id}/claim/init` and `/projects/{id}/claim/status` are not in the OpenAPI spec). If and when the backend lands, a follow-up ADR will re-propose the lifecycle aligned with the shipped server surface. **That follow-up is now [ADR 046: Claim Lifecycle v2](046-claim-lifecycle-v2.md)**, which supersedes this ADR.

## Original proposal

Zitadel setup would start in **pre-claim** mode: a developer or agent could create local auth configuration and run a mock/dev flow before the human signed up. Claim was meant to be a later human handoff that attached the project to an accountable team. Agents would initiate claim and return a `claim_url`, but would not complete claim. The CLI exposed `zitadel claim status` so a completed human handoff could refresh local state and unblock production apply.
