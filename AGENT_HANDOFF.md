# Agent Handoff
Last updated: 2026-06-04T16:37:32Z

## Branch
feat/passkey-frontend-register-login-fixes

## Recent commits
9cbfdda6 fix: consolidate login templates & complete i18n coverage (#216)
cba1f420 fix(flow): auto-login after password registration and fix passkey upsell 500
f7f940ef fix(sdk-next): use correct variable name url instead of issuerUrl in handleAuth
c938cde8 fix(ci): gofmt project_test.go, remove unused vi import, prettier sdk-next
53711c5e merge: integrate feat/passkey-registration into feat/passkey-frontend-register-login-fixes
671f476b fix: gofmt formatting for flow_state_machine_test.go
430da4cf Linting
7a7b6dff Rebase fix

## Working tree status
M  .changeset/README.md
M  .changeset/cli-drop-unused-flows.md
M  .changeset/cli-remove-claim-logic.md
M  .changeset/cli-scaffold-middleware.md
M  .changeset/cli-server-owned-schema-flow.md
M  .changeset/components-atoms-and-orchestrator.md
M  .changeset/components-orval-wireup.md
M  .changeset/components-replace-ui-lit-placeholders.md
M  .changeset/config.json
M  .changeset/design-tokens-and-ui-react.md
M  .changeset/fix-cli-nx-ci.md
A  .changeset/fix-release-pnpm-setup.md
A  .changeset/pre.json
A  .changeset/zitadel-scope-and-npm-publishing.md
M  .github/copilot-instructions.md
M  .github/instructions/typescript.instructions.md
M  .github/workflows/ci.yml
A  .github/workflows/release-npm.yml
M  .github/workflows/sync-design-tokens.yml
M  AGENTS.md
MM AGENT_HANDOFF.md
M  CONTRIBUTING.md
M  api/generated/oas_router_gen.go
M  apps/cli/README.md
M  apps/cli/SKILLS.md
M  apps/cli/package.json
M  apps/cli/src/commands/apply.ts
M  apps/cli/src/commands/doctor/checks/dependency.ts
M  apps/cli/src/commands/doctor/checks/schema.ts
M  apps/cli/src/commands/doctor/index.ts
M  apps/cli/src/commands/plan.ts
M  apps/cli/src/commands/setup/index.ts
M  apps/cli/src/lib/environment.ts
M  apps/cli/src/lib/errors.ts
M  apps/cli/src/lib/flows/build.ts
M  apps/cli/src/lib/flows/index.ts
M  apps/cli/src/lib/flows/validate.ts
M  apps/cli/src/lib/orca/patchers/rule/next/index.ts
M  apps/cli/src/lib/orca/patchers/rule/next/renderers/react/index.ts
M  apps/cli/src/lib/sync/syncers.ts
M  apps/cli/src/lib/sync/types.ts
M  apps/cli/src/lib/user-schema/build.ts
M  apps/cli/src/lib/user-schema/index.ts
M  apps/cli/tests/integration/flow-schema.test.ts
M  apps/cli/tests/integration/patch-eject.test.ts
M  apps/cli/tests/integration/setup-next.test.ts
M  apps/cli/tests/unit/commands/doctor.test.ts
M  apps/cli/tests/unit/commands/doctor/checks.test.ts
M  apps/cli/tests/unit/commands/eject.test.ts
M  apps/cli/tests/unit/lib/flows/build.test.ts
M  apps/cli/tests/unit/lib/orca/patchers/rule/file-writer/index.test.ts
M  apps/cli/tests/unit/lib/orca/patchers/rule/next/index.test.ts
M  apps/cli/tests/unit/lib/sync/loop.test.ts
M  apps/cli/tests/unit/lib/sync/syncers.test.ts
M  apps/cli/vitest.config.ts
M  apps/console-e2e/package.json
M  apps/console-e2e/playwright.config.mts
M  apps/console-e2e/src/visual-parity.spec.ts
M  apps/console/README.md
M  apps/console/index.html
M  apps/console/package.json
M  apps/console/src/components/atom-playground.tsx
M  apps/console/src/routes/__root.tsx
M  apps/console/src/styles.css
M  apps/console/vercel.json
M  apps/console/vite.config.mts
M  apps/demo-next-e2e/AGENTS.md
M  apps/demo-next-e2e/package.json
M  apps/demo-next-e2e/playwright.config.mts
M  apps/demo-next/README.md
AD apps/demo-next/harPwPk.har
MM apps/demo-next/next-env.d.ts
M  apps/demo-next/next.config.ts
M  apps/demo-next/package.json
 M apps/demo-next/query-demo.sql
M  apps/demo-next/src/app/admin/page.tsx
M  apps/demo-next/src/app/admin/widget.tsx
M  apps/demo-next/src/app/login/page.tsx
M  apps/demo-next/src/app/login/widget.tsx
M  apps/demo-next/src/custom-elements.d.ts
M  apps/demo-next/src/zitadel.ts
M  apps/demo-nuxt-e2e/AGENTS.md
M  apps/demo-nuxt-e2e/package.json
M  apps/demo-nuxt-e2e/playwright.config.mts
M  apps/demo-nuxt-e2e/src/auth-guard.spec.ts
M  apps/demo-nuxt-e2e/src/auth.spec.ts
M  apps/demo-nuxt/README.md
M  apps/demo-nuxt/nuxt.config.ts
M  apps/demo-nuxt/package.json
M  apps/demo-nuxt/pages/admin.vue
M  apps/demo-nuxt/pages/login.vue
M  apps/demo-nuxt/plugins/auth.server.ts
M  apps/demo-nuxt/plugins/zitadel-components.client.ts
M  apps/login-ui/package.json
M  apps/login-ui/src/main.ts
M  apps/login-ui/src/styles.css
M  apps/login-ui/tsconfig.app.json
M  apps/login-ui/vite.config.mts
MM cmd/server/server.go
M  docs/adrs/002-multi-package-release-strategy.md
M  docs/adrs/014-design-tokens-and-ui-react-pairs.md
M  docs/adrs/015-shared-component-styles.md
M  docs/adrs/016-global-api-initializer.md
M  docs/adrs/018-widget-owned-locale-resolution.md
M  docs/adrs/README.md
M  docs/design/cli/bdui-renderer.md
M  docs/design/flowengine/visualizer.html
M  docs/quick-start/login-ui.md
M  internal/api/error_handler.go
MM internal/api/flow.go
M  internal/api/flow_test.go
M  internal/api/handler.go
M  internal/api/integration_test/helpers/flow.go
M  internal/api/integration_test/helpers/passkey_registration.go
M  internal/api/integration_test/helpers/server.go
M  internal/api/integration_test/project_test.go
M  internal/api/integration_test/standalone_registration_test.go
M  internal/api/passkey.go
 M internal/api/security.go
A  internal/service/flow_passkey_registration.go
M  internal/service/passkey_registration.go
M  internal/service/passkey_registration_test.go
M  internal/staticui/console/embed.go
M  internal/staticui/login/embed.go
MM internal/storage/database/dialect/postgres/migration/sql/000010_passkey_registrations.sql
M  nx.json
M  package.json
M  packages/api-mock/AGENTS.md
M  packages/api-mock/package.json
M  packages/api-mock/src/branding.ts
M  packages/api-mock/src/fixtures/login.ts
M  packages/api-mock/src/flow-machine.ts
M  packages/api-mock/src/handlers.ts
M  packages/api-mock/src/index.browser.spec.ts
M  packages/api-mock/src/index.spec.ts
M  packages/api-mock/src/index.ts
M  packages/api-mock/src/lib/authn/index.ts
M  packages/api-mock/src/platform-handlers.ts
M  packages/api-mock/src/public-dir.ts
M  packages/api-mock/src/server.ts
M  packages/api-mock/src/spec-conformance.spec.ts
M  packages/api-mock/vitest.config.ts
A  packages/api/LICENSE
M  packages/api/README.md
M  packages/api/package.json
M  packages/api/tsdown.config.ts
M  packages/api/vitest.config.ts
M  packages/components/AGENTS.md
A  packages/components/LICENSE
M  packages/components/README.md
M  packages/components/dev/index.html
M  packages/components/dev/main.ts
M  packages/components/dev/pages/atoms.ts
M  packages/components/dev/pages/login.ts
M  packages/components/package.json
M  packages/components/src/atoms/zl-alert.ts
M  packages/components/src/atoms/zl-button.ts
M  packages/components/src/atoms/zl-card.ts
M  packages/components/src/atoms/zl-field.ts
M  packages/components/src/atoms/zl-icon.ts
M  packages/components/src/atoms/zl-page-shell.ts
M  packages/components/src/atoms/zl-pill.ts
M  packages/components/src/index.ts
M  packages/components/src/orchestrator/api-client.ts
M  packages/components/src/orchestrator/branding-to-tokens.ts
M  packages/components/src/orchestrator/branding-validator.ts
M  packages/components/src/orchestrator/branding.ts
M  packages/components/src/orchestrator/index.ts
M  packages/components/src/orchestrator/liquid.spec.ts
M  packages/components/src/orchestrator/mandatory-gates.spec.ts
M  packages/components/src/orchestrator/mandatory-gates.ts
M  packages/components/src/orchestrator/template-context.ts
A  packages/components/src/orchestrator/template-names.ts
M  packages/components/src/orchestrator/templates/layout-chrome.css
M  packages/components/src/orchestrator/zitadel-login.browser.spec.ts
M  packages/components/src/orchestrator/zitadel-login.spec.ts
M  packages/components/src/orchestrator/zitadel-login.ts
M  packages/components/src/orchestrator/zitadel-logout.browser.spec.ts
M  packages/components/src/orchestrator/zitadel-logout.spec.ts
M  packages/components/src/orchestrator/zitadel-logout.ts
M  packages/components/src/styles/surface.ts
M  packages/components/src/styles/tokens.ts
M  packages/components/src/tokens/index.ts
M  packages/components/tsdown.config.ts
M  packages/components/vite.config.mts
M  packages/components/vitest.config.ts
M  packages/design-tokens/README.md
M  packages/design-tokens/figma-tokens.lock
M  packages/design-tokens/package.json
M  packages/design-tokens/scripts/build.ts
M  packages/design-tokens/scripts/sync-from-figma.ts
M  packages/design-tokens/src/generated/tailwind.css
M  packages/design-tokens/src/generated/tokens.css
M  packages/design-tokens/src/generated/tokens.ts
M  packages/design-tokens/tsdown.config.ts
M  packages/design-tokens/vitest.config.ts
M  packages/lint/package.json
M  packages/sdk-core/README.md
M  packages/sdk-core/package.json
M  packages/sdk-core/vite.config.mts
M  packages/sdk-next/README.md
M  packages/sdk-next/eslint.config.js
M  packages/sdk-next/package.json
M  packages/sdk-next/src/client.ts
M  packages/sdk-next/src/lib/jwt.ts
M  packages/sdk-next/src/middleware.ts
M  packages/sdk-next/src/types.ts
A  packages/sdk-nuxt/LICENSE
M  packages/sdk-nuxt/README.md
M  packages/sdk-nuxt/eslint.config.js
M  packages/sdk-nuxt/package.json
M  packages/sdk-nuxt/src/index.ts
M  packages/sdk-nuxt/src/module.ts
M  packages/sdk-nuxt/src/runtime/composables/useZitadelProject.ts
M  packages/sdk-nuxt/src/runtime/lib/jwt.ts
M  packages/sdk-nuxt/src/runtime/plugin.ts
M  packages/sdk-nuxt/src/runtime/server/handler.ts
M  packages/sdk-nuxt/src/runtime/server/middleware.ts
M  packages/sdk-nuxt/src/runtime/types.ts
M  packages/shared-component-styles/AGENTS.md
M  packages/shared-component-styles/README.md
M  packages/shared-component-styles/package.json
M  packages/shared-component-styles/src/styles.css
M  packages/shared-component-styles/tsdown.config.ts
M  packages/ui-react/AGENTS.md
M  packages/ui-react/README.md
M  packages/ui-react/package.json
M  packages/ui-react/src/index.ts
M  packages/ui-react/src/pill.tsx
M  packages/ui-react/src/styles.css
M  packages/ui-react/tsdown.config.ts
M  pnpm-lock.yaml
A  scripts/check-changeset-required.mjs
M  scripts/sync-embedded-ui-dist.sh
M  tsconfig.base.json
?? AGENT_HANDOFF.md.tmp
?? apps/demo-next/harFail.har
?? internal/storage/database/dialect/postgres/migration/sql/000011_passkey_registrations_drop_fk.sql

## Diff stat
 .changeset/README.md                               |  44 +-
 .changeset/cli-drop-unused-flows.md                |   2 +-
 .changeset/cli-remove-claim-logic.md               |   4 +-
 .changeset/cli-scaffold-middleware.md              |   4 +-
 .changeset/cli-server-owned-schema-flow.md         |   6 +-
 .changeset/components-atoms-and-orchestrator.md    |   4 +-
 .changeset/components-orval-wireup.md              |  16 +-
 .../components-replace-ui-lit-placeholders.md      |  14 +-
 .changeset/config.json                             |  12 +-
 .changeset/design-tokens-and-ui-react.md           |  12 +-
 .changeset/fix-cli-nx-ci.md                        |   2 +-
 .changeset/fix-release-pnpm-setup.md               |   4 +
 .changeset/pre.json                                |  24 +
 .changeset/zitadel-scope-and-npm-publishing.md     |  10 +
 .github/copilot-instructions.md                    |   6 +-
 .github/instructions/typescript.instructions.md    |   9 +-
 .github/workflows/ci.yml                           |  40 +-
 .github/workflows/release-npm.yml                  | 102 ++++
 .github/workflows/sync-design-tokens.yml           |   6 +-
 AGENTS.md                                          |  40 +-
 AGENT_HANDOFF.md                                   | 629 ++++++++++++++-------
 CONTRIBUTING.md                                    |   6 +-
 api/generated/oas_router_gen.go                    | 378 ++++---------
 apps/cli/README.md                                 |   6 +-
 apps/cli/SKILLS.md                                 |  10 +-
 apps/cli/package.json                              |  11 +-
 apps/cli/src/commands/apply.ts                     |   2 +-
 apps/cli/src/commands/doctor/checks/dependency.ts  |   2 +-
 apps/cli/src/commands/doctor/checks/schema.ts      |   2 +-
 apps/cli/src/commands/doctor/index.ts              |   2 +-
 apps/cli/src/commands/plan.ts                      |   2 +-
 apps/cli/src/commands/setup/index.ts               |   6 +-
 apps/cli/src/lib/environment.ts                    |   2 +-
 apps/cli/src/lib/errors.ts                         |   2 +-
 apps/cli/src/lib/flows/build.ts                    |   2 +-
 apps/cli/src/lib/flows/index.ts                    |   4 +-
 apps/cli/src/lib/flows/validate.ts                 |   4 +-
 apps/cli/src/lib/orca/patchers/rule/next/index.ts  |   2 +-
 .../patchers/rule/next/renderers/react/index.ts    |  12 +-
 apps/cli/src/lib/sync/syncers.ts                   |   6 +-
 apps/cli/src/lib/sync/types.ts                     |   2 +-
 apps/cli/src/lib/user-schema/build.ts              |   2 +-
 apps/cli/src/lib/user-schema/index.ts              |   4 +-
 apps/cli/tests/integration/flow-schema.test.ts     |   2 +-
 apps/cli/tests/integration/patch-eject.test.ts     |   2 +-
 apps/cli/tests/integration/setup-next.test.ts      |   2 +-
 apps/cli/tests/unit/commands/doctor.test.ts        |   2 +-
 apps/cli/tests/unit/commands/doctor/checks.test.ts |   2 +-
 apps/cli/tests/unit/commands/eject.test.ts         |   2 +-
 apps/cli/tests/unit/lib/flows/build.test.ts        |   2 +-
 .../orca/patchers/rule/file-writer/index.test.ts   |   6 +-
 .../unit/lib/orca/patchers/rule/next/index.test.ts |   2 +-
 apps/cli/tests/unit/lib/sync/loop.test.ts          |   2 +-
 apps/cli/tests/unit/lib/sync/syncers.test.ts       |   2 +-
 apps/cli/vitest.config.ts                          |   2 +-
 apps/console-e2e/package.json                      |   2 +-
 apps/console-e2e/playwright.config.mts             |   2 +-
 apps/console-e2e/src/visual-parity.spec.ts         |   4 +-
 apps/console/README.md                             |  22 +-
 apps/console/index.html                            |   2 +-
 apps/console/package.json                          |   6 +-
 apps/console/src/components/atom-playground.tsx    |   4 +-
 apps/console/src/routes/__root.tsx                 |   2 +-
 apps/console/src/styles.css                        |   6 +-
 apps/console/vercel.json                           |   2 +-
 apps/console/vite.config.mts                       |   6 +-
 apps/demo-next-e2e/AGENTS.md                       |   8 +-
 apps/demo-next-e2e/package.json                    |   6 +-
 apps/demo-next-e2e/playwright.config.mts           |   4 +-
 apps/demo-next/README.md                           |  24 +-
 apps/demo-next/next.config.ts                      |   6 +-
 apps/demo-next/package.json                        |  12 +-
 apps/demo-next/query-demo.sql                      |   4 +-
 apps/demo-next/src/app/admin/page.tsx              |   2 +-
 apps/demo-next/src/app/admin/widget.tsx            |   2 +-
 apps/demo-next/src/app/login/page.tsx              |   2 +-
 apps/demo-next/src/app/login/widget.tsx            |   2 +-
 apps/demo-next/src/custom-elements.d.ts            |   4 +-
 apps/demo-next/src/zitadel.ts                      |   4 +-
 apps/demo-nuxt-e2e/AGENTS.md                       |   8 +-
 apps/demo-nuxt-e2e/package.json                    |   6 +-
 apps/demo-nuxt-e2e/playwright.config.mts           |   8 +-
 apps/demo-nuxt-e2e/src/auth-guard.spec.ts          |   2 +-
 apps/demo-nuxt-e2e/src/auth.spec.ts                |   2 +-
 apps/demo-nuxt/README.md                           |  22 +-
 apps/demo-nuxt/nuxt.config.ts                      |   8 +-
 apps/demo-nuxt/package.json                        |  10 +-
 apps/demo-nuxt/pages/admin.vue                     |   4 +-
 apps/demo-nuxt/pages/login.vue                     |   4 +-
 apps/demo-nuxt/plugins/auth.server.ts              |   2 +-
 .../demo-nuxt/plugins/zitadel-components.client.ts |   4 +-
 apps/login-ui/package.json                         |   6 +-
 apps/login-ui/src/main.ts                          |   2 +-
 apps/login-ui/src/styles.css                       |   2 +-
 apps/login-ui/tsconfig.app.json                    |   4 +-
 apps/login-ui/vite.config.mts                      |   2 +-
 cmd/server/server.go                               |  10 +-
 docs/adrs/002-multi-package-release-strategy.md    |  18 +-
 docs/adrs/014-design-tokens-and-ui-react-pairs.md  |  14 +-
 docs/adrs/015-shared-component-styles.md           |   2 +-
 docs/adrs/016-global-api-initializer.md            |  24 +-
 docs/adrs/018-widget-owned-locale-resolution.md    |   2 +-
 docs/adrs/README.md                                |   4 +-
 docs/design/cli/bdui-renderer.md                   |   6 +-
 docs/design/flowengine/visualizer.html             |   2 +-
 docs/quick-start/login-ui.md                       |   2 +-
 internal/api/error_handler.go                      |   2 -
 internal/api/flow.go                               |  47 +-
 internal/api/flow_test.go                          |   2 +-
 internal/api/handler.go                            |  39 +-
 internal/api/integration_test/helpers/flow.go      |   4 +-
 .../helpers/passkey_registration.go                |   1 -
 internal/api/integration_test/helpers/server.go    |   1 -
 internal/api/integration_test/project_test.go      |   1 +
 .../standalone_registration_test.go                | 155 -----
 internal/api/passkey.go                            | 101 ----
 internal/api/security.go                           |  37 ++
 internal/service/flow_passkey_registration.go      |  50 ++
 internal/service/passkey_registration.go           | 134 ++---
 internal/service/passkey_registration_test.go      |  35 +-
 internal/staticui/console/embed.go                 |   2 +-
 internal/staticui/login/embed.go                   |   2 +-
 nx.json                                            |   2 +-
 package.json                                       |   4 +-
 packages/api-mock/AGENTS.md                        |   8 +-
 packages/api-mock/package.json                     |   7 +-
 packages/api-mock/src/branding.ts                  |   4 +-
 packages/api-mock/src/fixtures/login.ts            |   2 +-
 packages/api-mock/src/flow-machine.ts              |   2 +-
 packages/api-mock/src/handlers.ts                  |   4 +-
 packages/api-mock/src/index.browser.spec.ts        |   4 +-
 packages/api-mock/src/index.spec.ts                |   4 +-
 packages/api-mock/src/index.ts                     |   4 +-
 packages/api-mock/src/lib/authn/index.ts           |   2 +-
 packages/api-mock/src/platform-handlers.ts         |   8 +-
 packages/api-mock/src/public-dir.ts                |   2 +-
 packages/api-mock/src/server.ts                    |   2 +-
 packages/api-mock/src/spec-conformance.spec.ts     |   4 +-
 packages/api-mock/vitest.config.ts                 |   4 +-
 packages/api/LICENSE                               |  21 +
 packages/api/README.md                             |   8 +-
 packages/api/package.json                          |  24 +-
 packages/api/tsdown.config.ts                      |  10 +-
 packages/api/vitest.config.ts                      |   2 +-
 packages/components/AGENTS.md                      |  18 +-
 packages/components/LICENSE                        |  21 +
 packages/components/README.md                      |  64 +--
 packages/components/dev/index.html                 |   4 +-
 packages/components/dev/main.ts                    |   6 +-
 packages/components/dev/pages/atoms.ts             |   4 +-
 packages/components/dev/pages/login.ts             |   8 +-
 packages/components/package.json                   |  14 +-
 packages/components/src/atoms/zl-alert.ts          |   4 +-
 packages/components/src/atoms/zl-button.ts         |   4 +-
 packages/components/src/atoms/zl-card.ts           |   4 +-
 packages/components/src/atoms/zl-field.ts          |   6 +-
 packages/components/src/atoms/zl-icon.ts           |   4 +-
 packages/components/src/atoms/zl-page-shell.ts     |   4 +-
 packages/components/src/atoms/zl-pill.ts           |   4 +-
 packages/components/src/index.ts                   |   5 +-
 packages/components/src/orchestrator/api-client.ts |  10 +-
 .../src/orchestrator/branding-to-tokens.ts         |   2 +-
 .../src/orchestrator/branding-validator.ts         |   2 +-
 packages/components/src/orchestrator/branding.ts   |   2 +-
 packages/components/src/orchestrator/index.ts      |  10 +-
 .../components/src/orchestrator/liquid.spec.ts     |   3 +-
 .../src/orchestrator/mandatory-gates.spec.ts       |   2 +-
 .../components/src/orchestrator/mandatory-gates.ts |   2 +-
 .../src/orchestrator/template-context.ts           |   2 +-
 .../components/src/orchestrator/template-names.ts  |  15 +
 .../src/orchestrator/templates/layout-chrome.css   |   2 +-
 .../src/orchestrator/zitadel-login.browser.spec.ts |   8 +-
 .../src/orchestrator/zitadel-login.spec.ts         |   8 +-
 .../components/src/orchestrator/zitadel-login.ts   |  13 +-
 .../orchestrator/zitadel-logout.browser.spec.ts    |   4 +-
 .../src/orchestrator/zitadel-logout.spec.ts        |   2 +-
 .../components/src/orchestrator/zitadel-logout.ts  |   4 +-
 packages/components/src/styles/surface.ts          |   2 +-
 packages/components/src/styles/tokens.ts           |   4 +-
 packages/components/src/tokens/index.ts            |   6 +-
 packages/components/tsdown.config.ts               |  18 +-
 packages/components/vite.config.mts                |  16 +-
 packages/components/vitest.config.ts               |   8 +-
 packages/design-tokens/README.md                   |  14 +-
 packages/design-tokens/figma-tokens.lock           |   2 +-
 packages/design-tokens/package.json                |   5 +-
 packages/design-tokens/scripts/build.ts            |   8 +-
 packages/design-tokens/scripts/sync-from-figma.ts  |   4 +-
 packages/design-tokens/src/generated/tailwind.css  |   2 +-
 packages/design-tokens/src/generated/tokens.css    |   2 +-
 packages/design-tokens/src/generated/tokens.ts     |   4 +-
 packages/design-tokens/tsdown.config.ts            |   4 +-
 packages/design-tokens/vitest.config.ts            |   4 +-
 packages/lint/package.json                         |   2 +-
 packages/sdk-core/README.md                        |   2 +-
 packages/sdk-core/package.json                     |  10 +-
 packages/sdk-core/vite.config.mts                  |   2 +-
 packages/sdk-next/README.md                        |   6 +-
 packages/sdk-next/eslint.config.js                 |   7 +-
 packages/sdk-next/package.json                     |   8 +-
 packages/sdk-next/src/client.ts                    |  15 +-
 packages/sdk-next/src/lib/jwt.ts                   |   6 +-
 packages/sdk-next/src/middleware.ts                |  10 +-
 packages/sdk-next/src/types.ts                     |   4 +-
 packages/sdk-nuxt/LICENSE                          |  21 +
 packages/sdk-nuxt/README.md                        |  12 +-
 packages/sdk-nuxt/eslint.config.js                 |   7 +-
 packages/sdk-nuxt/package.json                     |   8 +-
 packages/sdk-nuxt/src/index.ts                     |   2 +-
 packages/sdk-nuxt/src/module.ts                    |   2 +-
 .../src/runtime/composables/useZitadelProject.ts   |   7 +-
 packages/sdk-nuxt/src/runtime/lib/jwt.ts           |   6 +-
 packages/sdk-nuxt/src/runtime/plugin.ts            |   2 +-
 packages/sdk-nuxt/src/runtime/server/handler.ts    |   2 +-
 packages/sdk-nuxt/src/runtime/server/middleware.ts |   8 +-
 packages/sdk-nuxt/src/runtime/types.ts             |   6 +-
 packages/shared-component-styles/AGENTS.md         |   4 +-
 packages/shared-component-styles/README.md         |  12 +-
 packages/shared-component-styles/package.json      |   5 +-
 packages/shared-component-styles/src/styles.css    |   2 +-
 packages/shared-component-styles/tsdown.config.ts  |   2 +-
 packages/ui-react/AGENTS.md                        |   6 +-
 packages/ui-react/README.md                        |  14 +-
 packages/ui-react/package.json                     |  14 +-
 packages/ui-react/src/index.ts                     |   4 +-
 packages/ui-react/src/pill.tsx                     |   2 +-
 packages/ui-react/src/styles.css                   |   4 +-
 packages/ui-react/tsdown.config.ts                 |   6 +-
 pnpm-lock.yaml                                     | 536 ++++++++++++++++--
 scripts/check-changeset-required.mjs               |  68 +++
 scripts/sync-embedded-ui-dist.sh                   |   4 +-
 tsconfig.base.json                                 |   2 +-
 232 files changed, 2233 insertions(+), 1525 deletions(-)

## Notes from Claude

- **Goal:** Fix merge conflicts in PR #195 (`feat/passkey-registration` → `feat/passkey-to-flowengine`) and ensure all CI checks pass.

- **Completed:**
  - Rebased `feat/passkey-registration` onto `origin/feat/passkey-to-flowengine` (11 commits replayed).
  - Resolved all conflicts in 3 files:
    - `internal/domain/flow_state_machine_test.go` — kept HEAD's CurrentPurpose/flip-table/dispatch tests and appended passkey registration tests from the rebased commits; added missing `fakePasskeyRegistration` fake struct.
    - `cmd/server/server.go` — merged both `createUserHandler` and `passkeyRegSvc` wiring into `NewFlowStateMachine`.
    - `internal/api/integration_test/helpers/flow.go` — same dual-wiring merge for the test harness.
  - Regenerated OpenAPI code (`go generate ./api/...`) — no manual edits to `api/generated/`.
  - Fixed gofmt formatting on `flow_state_machine_test.go` (follow-up commit `671f476b`).
  - Force-pushed to `origin/feat/passkey-registration`.
  - All CI checks passed on run `26899788564`: go-unit-test, go-integration-test-postgres, go-integration-test-spanner, openapi-lint, node-check, node-e2e, goreleaser-snapshot, npm-pack-smoke, quickstart-smoke.

- **Remaining:** Nothing — PR #195 is conflict-free and fully green. It is ready to be reviewed and merged.

- **Failing tests:** None. All local and CI tests pass.

- **Key decisions:**
  - Used **rebase** (not merge) so PR history is linear and clean.
  - Generated files (`api/generated/*.go`) were never hand-edited — always regenerated via `go generate ./api/...` after resolving source-file conflicts.
  - `NewFlowStateMachine` now takes both `createUserHandler` and `passkeyRegSvc` — do not revert either to `nil`; both are required for full functionality.
  - `fakePasskeyRegistration` in `flow_state_machine_test.go` implements `domain.FlowPasskeyRegistrationService` as a simple struct-based fake (not a mock) to match the pattern used by other fakes in that file.

- **Run tests with:**
  ```
  go build ./...
  go vet ./...
  go test ./...
  go test -tags postgres_integration ./...
  go test -tags spanner_integration ./...
  ```

- **Suggested prompt for next agent:** PR #195 (`feat/passkey-registration` → `feat/passkey-to-flowengine`) is fully rebased, conflict-free, and all CI checks pass. The branch is ready for code review and merge. No further code changes are needed unless reviewers request them.
