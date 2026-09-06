# Developer experience principles

These principles define the product philosophy behind Zitadel Next. They
establish how we think about configuration, runtime state, operational actions,
developer workflows and interfaces, so that product, design and engineering
make decisions from the same mental model.

## 1. Start with the source of truth

Every capability in Zitadel should have a clearly defined source of truth
before we decide how developers interact with it.

The first question should not be:

- Should this live in the CLI?
- Should this have an API?
- Should this be editable in the Console?

Instead, ask:

> What is the source of truth for this capability?

There are three primary categories.

### Configuration

Configuration defines how authentication should behave.

Examples include:

- User schemas
- Authentication flows
- Branding
- Policies
- Identity providers
- Project and application configuration
- Environment configuration

Configuration is developer-owned. It should be versionable, reviewable,
validatable, previewable and safe to promote across environments.

The repository is the canonical source for configuration used to construct
releases. Other interfaces may create or import configuration revisions, but
runtime behaviour changes only when a release is deployed.

### Runtime state

Runtime state represents what is currently happening in the system.

Examples include:

- Users
- Sessions
- Tokens
- Audit events
- Runtime authorization state

Runtime state is platform-owned. It is created and managed while the system is
running and cannot be meaningfully versioned in source control.

### Lifecycle and operational actions

Some capabilities are neither configuration nor runtime state. They are actions
that move a resource through its lifecycle or operate the platform.

Examples include:

- Deploying a configuration release
- Promoting a release to another environment
- Rotating a credential
- Deactivating a user
- Revoking a session

These actions should be explicit, auditable and safe to automate.

The source of truth should determine the workflow. Interfaces should follow.

## 2. The repository is canonical, but not the only authoring experience

Developers should not be required to edit configuration files directly.
Different interfaces can provide different authoring experiences, as long as
they produce the same underlying configuration model.

For example:

- Guided experiences in the Console
- Direct editing in an IDE
- CLI commands
- AI-generated configuration

Regardless of how a change is authored, the resulting configuration should be
versionable, reviewable, validatable, previewable and promotable through the
standard software development workflow.

Different authoring experiences should never result in different configuration
models.

## 3. Identity should evolve with the application

Authentication should not feel like a separate product developers configure.
It should evolve alongside the application using the same software development
workflow.

For repository-owned configuration, the expected lifecycle is:

```text
Edit locally
   ↓
Review in PR
   ↓
Validate
   ↓
Build a release
   ↓
Deploy to an environment
   ↓
Promote when ready
```

Configuration should therefore be:

- Local-first
- Version-controlled
- Reviewable
- Testable
- Previewable
- Repeatable
- Safe to promote across environments

This does not mean every aspect of identity becomes code. Runtime state
continues to live in the platform. The goal is that authentication behaviour
follows the software development lifecycle instead of requiring a separate
setup and configuration workflow.

## 4. Design workflows before interfaces

The CLI, Console, API and MCP are not separate products. They are different
interfaces into the same underlying platform.

The primary question should not be:

- Should this live in the CLI?
- Should this be in the Console?
- Should this have an API?

Instead, ask:

- What is the developer trying to accomplish?
- Is this configuration, runtime state or an operational action?
- What workflow best supports that task?

Only then should we decide which interfaces participate in that workflow.

| Interface | Primary purpose |
| --- | --- |
| Repository | Canonical configuration used to construct releases |
| CLI | Developer workflows, scripting and automation |
| API | Platform capabilities, runtime operations and automation |
| Console | Understanding, guided authoring, ownership and operations |
| MCP / AI | AI-assisted workflows and structured automation |

A capability may be exposed through multiple interfaces, but each interface
should operate on the same underlying product model. The choice of interface
should optimise the developer experience, not create different behaviour or
competing sources of truth.

## 5. Integrate with developer workflows, don't replace them

Developers already have well-established workflows for building, reviewing and
deploying software. Zitadel should integrate with these workflows rather than
creating parallel ones.

We should use existing tools and conventions:

- Git for version history and collaboration
- Pull requests for review and approval
- CI/CD for validation and deployment
- Preview environments for testing changes before production

Zitadel should focus on identity-specific capabilities, such as validating
configuration, constructing immutable releases, previewing authentication
behaviour, detecting incompatible changes and safely deploying releases to
environments.

We should avoid recreating capabilities that developers already have unless
doing so provides clear additional value.

The goal is to make authentication feel like another part of the software
development lifecycle, not another workflow developers need to learn.

## 6. Design for humans, agents and automation from the beginning

Every capability should support interactive use, automation and AI-assisted
workflows without requiring different product models.

Capabilities should be:

- Deterministic
- Scriptable
- Discoverable
- Safe to automate
- Easy to validate
- Easy to audit

Where human judgement is required, such as ownership, trust boundaries, billing
or other security-sensitive decisions, the product should introduce an
explicit confirmation step. Everything else should be designed so it can be
performed consistently by a developer, a script or an AI agent.

## What this means in practice

When designing a new capability in Zitadel Next:

### 1. Start with the source of truth

Before designing APIs, UIs or CLI commands, decide whether the capability is:

- Configuration
- Runtime state
- A lifecycle or operational action

The source of truth should drive the experience, not the interface.

### 2. Design the workflow before the interfaces

Don't start by asking whether something should live in the CLI, Console or API.
Design the end-to-end developer workflow first, then decide which interfaces
best support each step.

### 3. Choose the right API model

Configuration APIs should support configuration workflows, including creating
and validating revisions, constructing immutable releases and deploying those
releases to environments.

Runtime state should expose CRUD APIs where appropriate. Lifecycle and
operational actions should be modelled explicitly rather than forced into CRUD.

### 4. Keep one product model

The CLI, Console, API and MCP should expose the same underlying capabilities.
Different interfaces may provide different experiences, but they should never
create competing behaviour or different sources of truth.

### 5. Integrate before you invent

Before building new functionality, ask:

- Does Git already solve this?
- Does CI/CD already solve this?
- Does a pull request already solve this?

Zitadel should add identity-specific capabilities, not recreate existing
developer tooling.

## Related decisions

- [Vision](../../VISION.md)
- [ADR 007: GitOps Configuration Surface](../adrs/007-gitops-configuration-surface.md)
- [ADR 035: Environment Releases for Configuration Resources](../adrs/035-configuration-environments.md)
