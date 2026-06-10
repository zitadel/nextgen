# Vision

The next-generation Zitadel preview is an evolution of the identity platform
people already trust and enjoy, rebuilt to be more flexible, more
developer-friendly, and native to the way humans and AI agents build software
together.

Our north star is simple: a human or agent should be able to add real
authentication to an app in about 90 seconds, without signup ceremony,
dashboard detours, or hand-copied client IDs. When the project is ready to be
shared, deployed, or governed, a human claims it, the work stays in place, and
the system becomes a team-owned identity platform configured like code.

This preview is not the finished product, and its public name may change. The
direction is clear: ship auth before signup, claim ownership when it matters,
and grow into production trust without surprising developers, agents, or
downstream applications.

## Current Reality

This repository is pre-release. The current checked-in CLI supports the local
Docker-backed setup flow documented in [README.md](README.md); it does not
currently ship a `zitadel claim` command.

Create-first, claim-later remains the product direction. The previous mock-only
claim lifecycle was removed until the real server-side claim contract exists;
[ADR 003](docs/adrs/003-create-first-claim-later.md) records that current
implementation state. Platform design notes may still describe the intended
claim flow, but those examples are target design, not shipped CLI behavior.

## Pre-Public Checklist

- **Vision and naming:** Use "next-generation Zitadel preview" and say the
  public name may change. Avoid treating `nextgen` as a permanent product name
  outside literal repository, package, Docker, or artifact identifiers.
- **Claim/link-first honesty:** Keep "ship auth before signup, claim later" as
  the direction, but label claim flow docs as target design until OpenAPI,
  server, and CLI support exist.
- **Agent-native contract:** Preserve the boundary that agents configure and
  humans claim. Keep `--non-interactive --json` and
  [apps/cli/SKILLS.md](apps/cli/SKILLS.md) as the canonical agent-facing CLI
  surface.
- **Licensing clarity:** Keep [LICENSING.md](LICENSING.md) explicit that the
  server, embedded console, and Docker images are AGPL-3.0-only, while root
  public docs, API contracts, CLI, SDKs, demos, and client-facing integration
  surfaces are MIT-licensed.
- **Metadata audit:** Keep the private root package metadata aligned with the
  AGPL default. Keep published MIT packages on `"license": "MIT"` with
  package-level `LICENSE` files.
- **Release posture:** Keep copy preview/alpha-safe: no official-release
  claims, no stable API promises, no claim-command promises, and no stale
  `@zitadel-nextgen/*` package wording unless referring to historical context.
