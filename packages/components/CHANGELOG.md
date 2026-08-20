# @zitadel/components

## 0.1.0-alpha.19

### Minor Changes

- [#830](https://github.com/zitadel/nextgen/pull/830) [`35d25c3`](https://github.com/zitadel/nextgen/commit/35d25c3add44611197363ff088fc940ee3858c78) Thanks [@fforootd](https://github.com/fforootd)! - Theming and header controls for the login surface:
  - The primary button now consumes the semantic `--zl-primary` /
    `--zl-primary-foreground` pair (Figma-owned values; the previous legacy
    role tokens remain as fallback). Expect a slight visual shift on stock
    buttons; setting the pair on the host element — or
    `branding.palette.primary` / `branding.palette.on_primary`, which now
    feed both vocabularies — restyles the CTA. Hover intentionally stays on
    the legacy hover role until Figma publishes a primary-scoped hover value.
  - `branding.palette.link` finally reaches the links: card navigation,
    forgot-password, and field links consume a new `--zl-color-text-link`
    contract variable (defined by default as an alias of the existing purple
    accent, which resolves per theme). Previously the palette key recolored
    pills instead of links.
  - New `suppress-header` boolean on `<zitadel-login>` and
    `<zitadel-session>` (and a `suppressHeader` prop on every framework
    wrapper): visually hides the widget's own heading block while keeping it
    in the accessibility tree — for embeds whose page already carries the
    heading. Works with user-ejected branding templates too.

### Patch Changes

- [#875](https://github.com/zitadel/nextgen/pull/875) [`d1e967d`](https://github.com/zitadel/nextgen/commit/d1e967d74ee339f9695f73185dd3097b19f527a2) Thanks [@fforootd](https://github.com/fforootd)! - The login widget now uses clearer identifier-step copy and avoids misleading initial focus:
  - The identifier step's primary button now says "Continue" ("Weiter" /
    "Continua") instead of "Sign in". The step branches to registration when
    the email is unknown, so "Sign in" promised an outcome the step cannot
    guarantee.
  - The widget no longer paints a focus ring on the primary action when a
    page-mode flow loads on a field-less step (e.g. the passkey-first
    preset's entry step). Script-moved focus with no prior interaction
    matches `:focus-visible`, which made the ring read as a pre-selected
    state. Initial focus now lands only on input fields; step swaps keep
    moving focus to the first control, where the browser derives the ring
    from the user's actual input modality.

- [#874](https://github.com/zitadel/nextgen/pull/874) [`c2888bd`](https://github.com/zitadel/nextgen/commit/c2888bdfd3c2a21fefd76a9b7fa80507d97cd88b) Thanks [@fforootd](https://github.com/fforootd)! - Branding asset URLs (`logo_url`, `hero_url`) may now use plain `http://` with canonical loopback hosts (`localhost`, dotted-decimal `127.0.0.0/8`, `[::1]`) so local development can serve login assets straight from the app's own dev server. The login component preserves those URLs only when it also runs on a loopback HTTP page; public pages and every other URL field remain HTTPS-only. The CLI plan, server save, editor, and component gates now enforce the same syntax and explain the carve-out when rejecting a URL.

- [#886](https://github.com/zitadel/nextgen/pull/886) [`61a0eee`](https://github.com/zitadel/nextgen/commit/61a0eee0abb310a834d94b72a74f351035021be8) Thanks [@fforootd](https://github.com/fforootd)! - A branding asset URL that is well-formed but unreachable no longer fails
  silently. `logo_url` / `hero_url` cleared every gate — the CLI's shape check
  and the server's save gate — published a revision, and then rendered as a 0×0
  `<img>`: no plan output, no apply output, no console error.

  Three changes close that hole:
  - `plan` and `apply` probe each asset URL (HEAD, 2.5s budget, in parallel) and
    emit a non-blocking warning when it is unreachable, returns a non-2xx
    status, or answers with something that is not an image. Advisory by design —
    the machine planning is not necessarily the machine rendering the login
    page — so it never fails a run. Set `ZITADEL_SKIP_ASSET_PROBE` to turn it
    off (offline, air-gapped CI, a CDN that only resolves from production) and
    `ZITADEL_ASSET_PROBE_TIMEOUT_MS` to retune the per-URL budget. Only public
    HTTPS destinations are contacted and redirects are re-validated;
    loopback/private/internal targets remain inconclusive rather than becoming
    network requests from the machine running the plan.
  - The login UI hides an asset that fails to load and restores either the split
    designs' decorative placeholder or the shipped design's authored no-logo
    content, so a broken asset degrades to the same result as no asset instead
    of a blank pane or missing compact brand. Templates could not do this
    themselves: they are DOMPurify-sanitised and inline `onerror` is stripped.
  - Branding revisions can now carry plan warnings at all; previously only
    create/update actions could, and branding is revisioned.

  Two readability fixes ride along. A branding `plan` no longer dumps the whole
  inlined Liquid template as one escaped line: an unchanged multi-line field
  renders as `(<n> lines, sha256:…)` and a changed one as a real line diff. And
  the branding dialect file scaffolded into `.zitadel/meta/` now spells its
  command mentions the way the generated app can run them
  (`npx @zitadel/cli@<version> apply`), matching the READMEs — the bare
  `zitadel apply` in the editor tooltip named a command that does not exist
  there.

- [#856](https://github.com/zitadel/nextgen/pull/856) [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344) Thanks [@fforootd](https://github.com/fforootd)! - The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.

- [#870](https://github.com/zitadel/nextgen/pull/870) [`b7235f7`](https://github.com/zitadel/nextgen/commit/b7235f7a0ede460e504376974b370d3d95e0d3c6) Thanks [@fforootd](https://github.com/fforootd)! - Update DOMPurify to address sanitizer bypass vulnerabilities in `@zitadel/components`.

- [#885](https://github.com/zitadel/nextgen/pull/885) [`f1049fd`](https://github.com/zitadel/nextgen/commit/f1049fd1b07086ffd070ecdd0b2d80958efd72f2) Thanks [@fforootd](https://github.com/fforootd)! - `zitadel setup` now pins the dev-server port in the scaffolded `dev` script for Next and Nuxt, so the app serves the port setup registered as the project's allowed origin. Previously a bare `next dev` / `nuxt dev` ignored that port and defaulted to 3000 — and Next silently moved to 3001 when 3000 was busy — so login rendered but the first submit failed with `origin "http://localhost:3000" is not allowed for this project`. The other frameworks already pinned the port in their own dev-server config (Vite's `server.port` + `strictPort`, Angular's `serve.options.port`) and are unchanged. An explicit port also turns a busy port into a loud `EADDRINUSE` instead of a silent move to a rejected origin.

  `doctor` verifies that dev script against the port recorded as the development issuer, so a script moved to another port is reported as an unapplied config edit and `doctor --fix` restores the registered port. `eject` now lists `package.json` among the edits it cannot auto-revert.

  A login that cannot start — a rejected origin being the most common cause — now reports the failure inside the login card instead of leaving a bare line of text on an otherwise empty page.

- [#873](https://github.com/zitadel/nextgen/pull/873) [`37e9cb9`](https://github.com/zitadel/nextgen/commit/37e9cb903943d34eebadfb44457872892f296823) Thanks [@fforootd](https://github.com/fforootd)! - Split-family login designs now look intentional out of the box. The brand pane renders a token-gradient placeholder panel until `branding.json` names a `logo_url`/`hero_url`, so a fresh `split`/`split-right` eject reads as a split layout instead of a lonely off-centre card. The "Secured with Zitadel" attribution now aligns under the form column in split-family designs (it previously centred across both panes) and recentres when the layout collapses to a single column on narrow containers.

- [#888](https://github.com/zitadel/nextgen/pull/888) [`11e6ab5`](https://github.com/zitadel/nextgen/commit/11e6ab57d611f4dc0f9732b958bff1302d4ea689) Thanks [@fforootd](https://github.com/fforootd)! - A `hero_url` no longer decides how tall the sign-in page is. In the `split` and
  `split-right` designs the brand pane took its height from the image, so an asset
  that is tall, square, or an SVG with no width/height of its own — the kind every
  framework scaffold ships in `public/` — stretched the pane past the viewport and
  pushed the "Secured with Zitadel" attribution below the fold. The hero now spans
  the brand pane's width with a capped height: a conventional wide banner renders
  exactly as before, and a taller asset is cropped to fit instead of growing the
  page. Set `--zl-split-hero-max-height` on the template root to raise or lower the
  cap for a design that wants a taller pane.

- [#888](https://github.com/zitadel/nextgen/pull/888) [`11e6ab5`](https://github.com/zitadel/nextgen/commit/11e6ab57d611f4dc0f9732b958bff1302d4ea689) Thanks [@fforootd](https://github.com/fforootd)! - A tall `logo_url` no longer stretches the `split` / `split-right` brand pane. The
  logo was capped in width but not in height, so a portrait lockup — a mark stacked
  above a wordmark, say — kept the height its own proportions asked for and grew the
  pane past the viewport. It is now capped in both directions and scales down whole,
  never cropped: a logo that already fit is untouched, and a small one is still shown
  at its own size rather than blown up to fill the pane. When a logo and a hero share
  the pane the logo takes the smaller header-mark cap, so the two together still leave
  the "Secured with Zitadel" badge on screen. Set `--zl-split-logo-max-height` on the
  template root if your lockup wants more room.
- Updated dependencies [[`c2888bd`](https://github.com/zitadel/nextgen/commit/c2888bdfd3c2a21fefd76a9b7fa80507d97cd88b), [`61a0eee`](https://github.com/zitadel/nextgen/commit/61a0eee0abb310a834d94b72a74f351035021be8), [`79f5ce1`](https://github.com/zitadel/nextgen/commit/79f5ce1db6b36baab85944a667072f1936880704), [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344), [`41f6a0a`](https://github.com/zitadel/nextgen/commit/41f6a0a7c60e28a9adecfa9d72b964a305f7ba3d), [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657), [`4e04e5f`](https://github.com/zitadel/nextgen/commit/4e04e5fb2a9585669b75d2b188b0966bfb23f4e7), [`9ef7096`](https://github.com/zitadel/nextgen/commit/9ef709667f1a6f7bd5126491bf4039a34a43a792), [`37e9cb9`](https://github.com/zitadel/nextgen/commit/37e9cb903943d34eebadfb44457872892f296823), [`433f81c`](https://github.com/zitadel/nextgen/commit/433f81cffc3e3e8499c555aa45b2a45aa557916f)]:
  - @zitadel/config@0.1.0-alpha.19

## 0.1.0-alpha.18

### Minor Changes

- [#686](https://github.com/zitadel/nextgen/pull/686) [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c) Thanks [@fforootd](https://github.com/fforootd)! - New types-only `@zitadel/components/jsx` entry with React JSX declarations for `<zitadel-login>`, `<zitadel-session>`, and `<zitadel-logout>`, covering each element's full attribute/property surface plus React's standard `ref`/`key` (a `ref` resolves to the concrete element type). Reference it once (`/// <reference types="@zitadel/components/jsx" />`) to type the custom elements in TSX.

- [#686](https://github.com/zitadel/nextgen/pull/686) [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c) Thanks [@fforootd](https://github.com/fforootd)! - The built-in locale dictionaries ship neutral email copy — "Email" / "you@example.com" (de: "du@beispiel.de", it: "E-mail" / "tu@esempio.com") — instead of the business-flavored "Work email" / "you@company.com". Products that want the previous work-email framing spread the new `businessLocales` overlay over the built-in dictionary via the `locales` property. The `it` dictionary is now also exported from the package root.

- [#686](https://github.com/zitadel/nextgen/pull/686) [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c) Thanks [@fforootd](https://github.com/fforootd)! - `<zitadel-session>` is now embeddable and themable like `<zitadel-login>`: it shares the same surface contract with `variant` (default `widget` — content-sized, transparent, no font injection; `page` claims the viewport and paints the surface via its internal page shell) and `theme` (`light` / `dark` / `auto`, resolved against the variant fallback instead of hardcoding dark). `<zitadel-logout>` also resolves `theme` now instead of pinning `data-theme="dark"`. Breaking within the alpha: `<zitadel-session>` no longer renders page-like by default — dedicated signed-in routes must set `variant="page"`.

### Patch Changes

- [#259](https://github.com/zitadel/nextgen/pull/259) [`ff66683`](https://github.com/zitadel/nextgen/commit/ff66683eeb0daa3a12e7d11fed01076ac8c2ba58) Thanks [@peintnermax](https://github.com/peintnermax)! - `<zitadel-login>` maps the browser's back gesture to a step's `kind: "back"` action via a single re-armed History API sentinel entry (no URL changes). Back-navigation is gesture-only: the default template and all shipped branding designs render no visible control for the action, and the kind-based exclusion keeps it out of the generic secondary-button loop. Tenant templates can still render an explicit control from the wire action.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Emit `zitadel-flow-step` for the first step, not just for steps reached by submitting. A host app driving its own chrome from the flow step — progress indicators, headings, analytics — previously saw nothing until after the visitor's first submit; `startFlow()` now announces the applied step exactly as `submit()` does.

  Scope the compact brand header's height cap to images. `.zl-split__compact` is shared by the split designs' `<img>` logo and the hero design's `<p>` text fallback, so the 2.5rem cap meant for a logo clipped tenant-edited brand copy the moment it wrapped. Both image caps (2.5rem logo, 6rem hero banner) are now `img`-qualified so they resolve by source order, and the text fallback gets full width plus safe wrapping.

  Documents and pins the host-page styling contract: a plain `zitadel-login { --zl-*: … }` rule in the embedding app's own stylesheet reaches the atoms' internal shadow roots and outranks both the design-system defaults and the tenant's server-side branding, per the CSS cascade's encapsulation-context step. No behaviour change — it already worked — but it is now a covered contract rather than an accident, which also fixes it in place as a constraint on how the orchestrator may express token defaults.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Expose `--zl-page-min-height` so host pages can size the embedded login widget to content (`auto`) instead of the default full-viewport page shape; releases both the orchestrator mount and the `zl-page-shell` atom.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Add the `hero` landing design, a mobile compact brand header for split-family designs, split layout knobs (`--zl-split-columns`, `--zl-split-align`, `--zl-split-brand-mobile`), and a warn-once console signal for missing text keys.

- [#818](https://github.com/zitadel/nextgen/pull/818) [`310014f`](https://github.com/zitadel/nextgen/commit/310014f1ec8df441b161d12bb01658d27aa1f478) Thanks [@bastionstack](https://github.com/bastionstack)! - `theme="light"` now paints every part of the login surface, not just its resting colours. Hover, pressed and focus states on buttons, fields and selects re-theme with the mode, the card keeps a visible edge, and the attribution pill follows the light palette. Dark mode is unchanged.

  Three semantic tokens carry the interactive states: `--zl-color-surface-hover-strong`, `--zl-color-surface-hover-subtle` and `--zl-color-border-hover`. Surfaces should reach for these rather than the raw `--zl-color-gray-*` ramp, which is mode-independent by design and keeps its dark shade on a light page.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Ship a real light theme. The legacy `--zl-color-*` tokens the auth atoms consume are now authored as `{ dark, light }` pairs and emitted into the `[data-theme="light"]` block, so switching modes actually repaints surfaces, text, borders, icons, and the focus ring — previously that block only carried the shadcn namespace, and light mode resolved correctly while every surface stayed dark. `<zitadel-login>` gains a `theme` property (`light | dark | auto`); resolution runs element property → `branding.theme.mode` → variant default, where a `page` stays dark (the design system's primary surface) and an embedded `widget` follows `prefers-color-scheme` instead of forcing a dark card onto a light host page.

- [#404](https://github.com/zitadel/nextgen/pull/404) [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c) Thanks [@vitorbari](https://github.com/vitorbari)! - Login flow: enforce required fields client-side and show inline errors on every control.
  - Submit-type `<zl-button>` now delegates to the form, so the primary action
    can't bypass validation; non-submit buttons keep emitting `zl-submit` for
    ungated navigation (back, skip, passkey, sign-in/register switch).
  - On submit the orchestrator checks the step's `required` fields via each atom's
    live `formValue` (so autofill that skipped `input` events is still seen) and
    surfaces an empty one through the server's own `error.<field>_required`
    dialect — styled and localised exactly like a backend rejection, with no
    native validation bubble. Checkboxes are excluded: a rendered checkbox always
    submits a real boolean (`false` when unticked), so a must-accept boolean is a
    schema concern (`const: true`), keeping browser and API clients aligned.
  - Field errors render inline under every control type, not just email/password:
    `<zl-select>` and `<zl-checkbox>` gained an `error` / `invalid` contract (with
    React `Select` / `Checkbox` parity, including a generated fallback id so the
    error stays wired to the control via `aria-describedby`). Selected values and
    checkbox states survive an error re-render.

- [#404](https://github.com/zitadel/nextgen/pull/404) [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c) Thanks [@vitorbari](https://github.com/vitorbari)! - Login flow: render and submit `select` and `checkbox` user-schema fields.
  - The default template renders `select` / `checkbox` field types as
    `<zl-select>` / `<zl-checkbox>`.
  - `<zl-select>` / `<Select>` are agent-first: a real native `<select>` is the
    operable, accessible, automatable control, with the Figma-styled trigger kept
    as a pointer-only visual layer. Screen readers, keyboard users, password
    managers and automation drivers can now pick an option (e.g. enum schema
    fields during CLI-driven registration).
  - The orchestrator captures every input atom through a uniform `formValue`
    contract, so `<zl-select>` and `<zl-checkbox>` submit the right shape: a
    checkbox as a real JSON boolean, a select as its chosen enum member, with
    empty enum values omitted so an untouched optional select isn't rejected by
    the server's enum check.
  - The leading placeholder row drops any empty-valued member the schema enum
    itself lists, so no duplicate empty option is rendered.
  - The styled popup closes on `Escape` for pointer users (keyboard users already
    get this from the native `<select>`).
  - The `{% mandatory_gates %}` safety net recognises `<zl-select>` /
    `<zl-checkbox>`, so a required select or checkbox no longer gets a duplicate
    generic text field appended.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Forward atom CSS Shadow Parts through `<zitadel-login>`: host pages can now restyle atom internals with `zitadel-login::part(<atom>-<part>)` (e.g. `field-input`, `button-root`); the mapping is derived from the atom manifests and stamped on every render, covering gate-patched atoms too.

- [#593](https://github.com/zitadel/nextgen/pull/593) [`6394228`](https://github.com/zitadel/nextgen/commit/6394228f61426eed4bd28d0df781a98b42a9ac95) Thanks [@fforootd](https://github.com/fforootd)! - Security: update DOMPurify in `@zitadel/components` and gRPC in `@zitadel/server`, and refresh vulnerable workspace dependencies tracked by Dependabot.

- [#660](https://github.com/zitadel/nextgen/pull/660) [`1395911`](https://github.com/zitadel/nextgen/commit/1395911519a40ceb4e06e8b68729376553d2768d) Thanks [@fforootd](https://github.com/fforootd)! - Update `liquidjs` to 10.27.2. 10.27.1 charges the `pop` filter against
  `memoryLimit` (CVE-2026-55575); 10.27.2 extends that accounting to the
  `join`, `json`, and `inspect` filters.

- [#563](https://github.com/zitadel/nextgen/pull/563) [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80) Thanks [@fforootd](https://github.com/fforootd)! - Tenant-customizable login templates land end to end (ADR 040): eject a
  design, edit real Liquid, `plan`/`apply` publishes it, and the login
  renders it.
  - `@zitadel/server`: new Branding API (`POST /branding`,
    `GET /branding`, `GET /branding/{id}`) storing immutable per-project
    branding revisions with a lexical template gate (size, encoding,
    `<script>`/`<style>`, inline handlers, `javascript:` URLs, `| raw`).
    Flow responses now resolve the latest revision per project instead of
    the hardcoded default.
  - `@zitadel/api`: generated client and zod schemas for the Branding API.
  - `@zitadel/config`: the authoritative LiquidJS template validator
    (`@zitadel/config/template`), the `branding.json` config dialect
    meta-schema, and the ejectable design catalog (`centered`, `split`,
    `split-right`, `minimal`) with `getDefaultBrandingConfig`.
  - `@zitadel/components`: split/minimal layout chrome for the design
    catalog; the `{% mandatory_gates %}` tag name is now single-sourced
    from `@zitadel/config/template`.
  - `@zitadel/cli`: `.zitadel/branding/` becomes a synced resource — a
    `branding.json` descriptor plus a sibling `login.liquid` the CLI
    inlines on upload. `zitadel branding eject [--design <name>]`
    scaffolds it, `zitadel setup --design <name>` does so at setup and
    publishes revision 1, and `plan`/`apply` validate templates with the
    authoritative validator and publish edits as new revisions.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Flip `<zitadel-login>` to widget-first: the default `variant="widget"` is content-sized, transparent through every layer, injects no default font into the host document, and never steals focus on load — the embedding app owns the page. Dedicated login routes (hosted shell, scaffolded pages) opt into the previous full-page behavior with `variant="page"`. Split-family responsive chrome now keys off the widget's own width via container queries (baseline 2023 browsers), the hero design ships neutral placeholder copy instead of fabricated claims, and split tenants with only a `hero_url` keep a compact banner fallback on narrow widths.

- [#716](https://github.com/zitadel/nextgen/pull/716) [`65da8b1`](https://github.com/zitadel/nextgen/commit/65da8b18b8a1af4e484d7cf494f8142f0539fb41) Thanks [@fforootd](https://github.com/fforootd)! - fix: `variant="widget"` no longer pads around the card. The internal page shell kept its full-page padding chrome (52px vertical at desktop widths) in widget mode, so `<zitadel-login>`/`<zitadel-session>` embedded in an app's own container rendered with dead space above and below the card — a 682px host around a 514px card. Widget mode now sheds the shell padding along with the background and viewport sizing it already dropped, making the host box hug the card as the content-sized embedding contract promises. The shipped `minimal` branding design sheds its pane padding the same way (it has no card, so that padding was page chrome too); the split designs' pane padding is part of their composition and intentionally stays. `variant="page"` is unchanged everywhere.

- Updated dependencies [[`ff66683`](https://github.com/zitadel/nextgen/commit/ff66683eeb0daa3a12e7d11fed01076ac8c2ba58), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8), [`418457f`](https://github.com/zitadel/nextgen/commit/418457f7407c712f3ff02b30df014fbf12e03d23), [`1395911`](https://github.com/zitadel/nextgen/commit/1395911519a40ceb4e06e8b68729376553d2768d), [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80), [`2cf426e`](https://github.com/zitadel/nextgen/commit/2cf426e0bbe9d27059d748f16272bd1674408dc0), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c)]:
  - @zitadel/config@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- [#544](https://github.com/zitadel/nextgen/pull/544) [`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999) Thanks [@fforootd](https://github.com/fforootd)! - Fixes from alpha.16 community feedback:
  - Custom schema fields now render a readable label. A property with no
    catalog entry (e.g. `department`, `dateOfBirth`) falls back to a
    humanised name ("Department", "Date of birth") on the form instead of
    leaking the raw `<step>.field.<name>` text key. A catalogued key still
    wins, so localised labels are unaffected.
  - The scaffolded `.zitadel/flows/README.md` no longer contains the
    "Presets" section twice.
  - The `warn/default-flow-swap` plan warning now leads with the impact in
    plain language: the new flow becomes the default for its purposes, and
    every page that does not explicitly set `flow-name` on
    `<zitadel-login>` will start rendering it — scope it via `audience`
    or pin `flow-name` to opt out.
  - The flip-table validation error (login/register entry step missing its
    `user_not_found`/`user_already_exists` transition) now explains who
    gets stuck where: someone without an account would be stuck at
    sign-in instead of being routed to registration, and vice versa. Plan,
    apply, and the server report the same wording.

- [#525](https://github.com/zitadel/nextgen/pull/525) [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65) Thanks [@fforootd](https://github.com/fforootd)! - Every engine-emitted step error is now a localizable `error.*` catalog
  key — no `auth_attempt.*` literals leak into the login UI anymore.
  Rejected passkey proofs emit `error.passkey_invalid` (assertion) and
  `error.passkey_registration_invalid` (attestation), translated in every
  builtin locale; rejected password submissions emit the existing
  `error.invalid_credentials`, which the login component routes inline to
  the password field. The `step.error` contract docs now describe the
  `error.*` catalog plus verbatim outcome tokens (e.g. `user_not_found`)
  instead of citing `auth_attempt.*` diagnostics.

- [#543](https://github.com/zitadel/nextgen/pull/543) [`a0b39a1`](https://github.com/zitadel/nextgen/commit/a0b39a119408a6fa02e8e1e45ebd5dd14b96c01b) Thanks [@fforootd](https://github.com/fforootd)! - Automation hooks for auth-method credential fields are now method-named,
  matching what the docs have always promised: a flow field named
  `x-auth-methods#password` renders `data-testid="zitadel-field-password"`
  and `zitadel-input-password` instead of leaking the raw field name into
  the hooks. The `name` attribute (the wire/form key) is unchanged.
  Scripts that targeted the raw `zitadel-field-x-auth-methods#password`
  form must switch to the documented method-named hooks.

## 0.1.0-alpha.16

### Patch Changes

- [#495](https://github.com/zitadel/nextgen/pull/495) [`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852) Thanks [@fforootd](https://github.com/fforootd)! - Fix the duplicate "Continue with passkey" button: flow responses no longer embed a stale copy of the default login template. The login widget renders the up-to-date template bundled with `@zitadel/components`, which also brings checkbox/select field rendering and the empty-subtitle guard to real flows. A tenant-provided `branding.liquid_template` still takes precedence.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - Flow field validation errors now travel as localisation keys instead of
  developer strings: `step.error` carries `error.<field>_<rule>` per violation
  ("; "-joined, format spelled `_invalid` to match the catalog), and the login
  components localise them — catalog-known keys render inline on their field,
  unknown fields resolve through new generic `error.field_<rule>` fallbacks
  interpolated with the step's field label (en/de/it). A key routed inline whose
  field is not on the step downgrades to a visible banner message instead of
  disappearing. Users see "Please enter a valid email" instead of
  "flow field email: format".

- [#514](https://github.com/zitadel/nextgen/pull/514) [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2) Thanks [@fforootd](https://github.com/fforootd)! - Select a flow definition by name. `<zitadel-login>` gains a `flow-name`
  attribute (`flowName` prop on every framework wrapper) that sends
  `flow_definition_name` on flow start, so a project with several synced
  flows can run a specific one instead of the audience-resolved default.
  An unknown name or a purpose mismatch surfaces as a clear startup error
  naming the attribute. Audience selection itself is now honored and
  deterministic: hinted app beats hinted team beats the newest unscoped
  flow, and a flow scoped to an app/team no longer captures the project
  default. The flows README and plan/apply docs explain how to add and
  select a second flow.

  Because newest-unscoped-wins means a new flow can silently take over the
  default login, `plan` warns on any create of an active, unscoped flow in
  a project that already has flows (`warn/default-flow-swap`, a
  non-blocking `# warning:` line and a `--json` warnings entry) — scope
  the flow via `audience` or pin `flow-name` in the widget to opt out.
  The offline dialect gains the committed `auth-methods`/`auth-method`
  meta-schema copies that `user-schema.json` references, so editors
  resolve the full dialect without network access.

- [#496](https://github.com/zitadel/nextgen/pull/496) [`754c7f6`](https://github.com/zitadel/nextgen/commit/754c7f6d8b970438a5ffa2c5c57ef72a2b5ed657) Thanks [@fforootd](https://github.com/fforootd)! - Custom flow steps no longer render a raw `<step>.action.back` key on the back
  button: the `| t` filter now falls back to a generic `action.back` entry
  (shipped in en/de/it) when a step-specific key is missing. Step-specific keys
  still win when defined.

- [#497](https://github.com/zitadel/nextgen/pull/497) [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87) Thanks [@fforootd](https://github.com/fforootd)! - The passkey origin-allowlist rejection now names the allowed origins (e.g. `origin "http://127.0.0.1:3000" is not allowed for this project (allowed: http://localhost:3000)`), and `<zitadel-login>` surfaces the server's error message instead of a generic "returned 400". `@zitadel/api` exports the new `apiErrorMessage` helper for extracting the server error envelope from an `ApiError`.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - The login form now shows a "Waiting for your passkey…" status with a Cancel
  button while a WebAuthn ceremony is in flight; cancelling aborts the ceremony
  and returns to the step with the fallback actions usable. Ceremony timeouts get
  their own copy (`error.passkey_timeout`) instead of reading as cancellations,
  and the cancelled copy no longer says "setup" for login ceremonies.
  `<zl-passkey>` emits a new `zl-passkey-started` event and accepts
  `pending-label`, `cancel-label`, and `silent` attributes. Step error banners
  are dismissible and clear as soon as the user edits a field (the edited
  field's inline error clears too); errors reappear only if the server
  re-reports them.

- [#500](https://github.com/zitadel/nextgen/pull/500) [`69b6b6a`](https://github.com/zitadel/nextgen/commit/69b6b6a0fa934cbbd81deba46192b3b1346612a8) Thanks [@fforootd](https://github.com/fforootd)! - `zitadel setup` now asks "How should users sign in?" and scaffolds the
  matching schema+flow preset: `password-first` (today's default) or
  `passkey-first` (a one-tap passkey on the login entry step with an
  email → password fallback path, passkey-primary registration, and email
  kept required so the fallback always works). Non-interactive and scripted
  runs use `--preset`; the choice is recorded in `zitadel.json`. Presets are
  named bundles under `@zitadel/config` (the mechanism behind app-type
  selection, [#448](https://github.com/zitadel/nextgen/issues/448)) and are hygiene-tested: every bundle must pass the flow
  validator and resolve every text key in every builtin locale.

## 0.1.0-alpha.15

### Patch Changes

- [#486](https://github.com/zitadel/nextgen/pull/486) [`f45d47c`](https://github.com/zitadel/nextgen/commit/f45d47c5850edc83a55b5ad7364a59ffac4fd37c) Thanks [@fforootd](https://github.com/fforootd)! - Fix the default login template rendering two passkey buttons when the flow marks the passkey action as primary.

## 0.1.0-alpha.14

### Minor Changes

- [#443](https://github.com/zitadel/nextgen/pull/443) [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630) Thanks [@bastionstack](https://github.com/bastionstack)! - Add a post-sign-in `<zitadel-session>` "signed in as" card: a dedicated element exposed through every SPA SDK and re-exported from sdk-next. CLI scaffolds now render it as the post-sign-in `/profile` page (with a Logout action) across all frameworks. Identity is read from `GET /sessions/me`, preferring `name` then `email` then `user_id`.

  `<zitadel-logout>` now sources its identity from the same `getMySession` operation instead of the `__nextgen_display` cookie, so both signed-in surfaces work against the real backend. Both components route their `getMySession`/`revokeMySession` calls through the shared `api-client` wrappers that enforce `credentials: "include"`.

### Patch Changes

- [#453](https://github.com/zitadel/nextgen/pull/453) [`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b) Thanks [@vitorbari](https://github.com/vitorbari)! - Add back navigation to interactive flows. The engine injects a `back` action on rendered step responses when there's a step to return to, and clears the back stack past irreversible mutations (user creation, passkey registration) and at flow termination.

## 0.1.0-alpha.13

### Patch Changes

- [#417](https://github.com/zitadel/nextgen/pull/417) [`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293) Thanks [@fforootd](https://github.com/fforootd)! - Label passkey registrations with collected identifiers and request discoverable credentials while keeping WebAuthn user handles opaque.

## 0.1.0-alpha.12

### Minor Changes

- [#390](https://github.com/zitadel/nextgen/pull/390) [`2c32a90`](https://github.com/zitadel/nextgen/commit/2c32a90b41bdc7da736a2c3be0e8e851dbe59333) Thanks [@bastionstack](https://github.com/bastionstack)! - Add the `Checkbox` and `Select` atoms in both renderers, and render the
  `checkbox` and `select` field types in the orchestrator.
  - `@zitadel/components`:
    - New form-associated `<zl-checkbox>` Lit atom (Figma `Checkbox` `4387:460`,
      `Checkbox / With Label` `6634:1868`): optional `label` (or default slot),
      `checked` / `disabled` / `required` / `value` / `name`, a `zl-change` event,
      and full form participation (`setFormValue` / `setValidity` / reset / focus
      delegation).
    - New form-associated `<zl-select>` Lit atom (Figma `Dropdown` `4397:4816`,
      `Input text` `4397:4098`): a select-only combobox following the WAI-ARIA
      pattern with keyboard navigation. Options accept either a JS array
      (`.options`) or a JSON `options` attribute; `value` / `placeholder` /
      `disabled` / `required` and a `zl-change` event.
    - New `chevron-down` icon.
    - Both atoms registered in the manifest registry.
    - Orchestrator: the default Liquid template now renders `select` and
      `checkbox` field types as `<zl-select>` / `<zl-checkbox>`; select options
      are built from the field's `validation.enum` via a new `selectOptions`
      filter.
  - `@zitadel/ui-react`: new paired `<Checkbox>` and `<Select>` React components
    that mirror the Lit atoms' DOM and share their surface CSS.

  Shared `checkbox.css` and `select.css` (+ their `lit/*-host.css`) were added to
  `@zitadel/shared-component-styles`. No new design tokens were required.

### Patch Changes

- [#337](https://github.com/zitadel/nextgen/pull/337) [`237c3c7`](https://github.com/zitadel/nextgen/commit/237c3c73a319e74c1411e3b04a1bb1a0e9d91051) Thanks [@bastionstack](https://github.com/bastionstack)! - Scaffolded app pages now enforce the dark surface the Zitadel widgets are designed for (`color-scheme: dark`, `#0f0f11`), instead of following the OS light/dark setting — across every framework template (`next`, `react`, `vue`, `angular`, `nuxt`, `solid`, `svelte`, `qwik`). This fixes the inconsistency where the `<zitadel-logout>` avatar (and other non-widget chrome, e.g. the `/profile` view) rendered on a white background while `<zitadel-login>` enforced its own dark surface.

  Removed misleading field hints from the login component locales (`en`, `de`, `it`): the password "include a symbol and number" hint (only `minLength` is enforced server-side) and the `YYYY-MM-DD` date-of-birth hint (native `<input type="date">` localizes its own format and submits ISO). A dynamic, validation-rule-driven hint is tracked in [#251](https://github.com/zitadel/nextgen/issues/251).

## 0.1.0-alpha.11

### Minor Changes

- [#309](https://github.com/zitadel/nextgen/pull/309) [`0b81768`](https://github.com/zitadel/nextgen/commit/0b8176857395d25c95343b5b320d074e0ba2c102) Thanks [@bastionstack](https://github.com/bastionstack)! - Load the design-system brand font (Arimo) by default in `<zitadel-login>` so the
  auth UI paints the brand face even when the server returns no branding; headings
  render in bold Arimo. Tenant `branding.font_url` still overrides it. Exposes
  `applyDefaultFont` and `DEFAULT_BRAND_FONT_HREF` so deployments can self-host the
  default face.

## 0.1.0-alpha.10

### Patch Changes

- [#328](https://github.com/zitadel/nextgen/pull/328) [`acb5b54`](https://github.com/zitadel/nextgen/commit/acb5b549386efcc5ede005871b145c1cd0f9ac5e) Thanks [@fforootd](https://github.com/fforootd)! - Improve fresh-app CLI recovery guidance and align agent automation hook docs with the rendered login controls.

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- [#270](https://github.com/zitadel/nextgen/pull/270) [`30b4b41`](https://github.com/zitadel/nextgen/commit/30b4b411a9c99fc61d991f739636f93d7bee5b1d) Thanks [@vitorbari](https://github.com/vitorbari)! - Step `fields` and `actions` are now ordered `[{ name, ... }]` arrays on the wire (ADR 021). Templates iterate them in authorial order; the orchestrator builds `fields_by_name` / `actions_by_name` views for keyed lookups. The private `@zitadel/api-mock` workspace follows the same wire shape for tests. `gates` stays a name-keyed object for now.

## 0.1.0-alpha.5

### Patch Changes

- [#299](https://github.com/zitadel/nextgen/pull/299) [`f77ca44`](https://github.com/zitadel/nextgen/commit/f77ca44e85565976d26de0b6444b7fc5b1616e8c) Thanks [@fforootd](https://github.com/fforootd)! - Make the generated Next.js auth app easier for agents and developers to prove end-to-end registration, logout, and login in a visible browser.

- [#286](https://github.com/zitadel/nextgen/pull/286) [`3795b67`](https://github.com/zitadel/nextgen/commit/3795b6793c72b92300fc6a7d21c7562f0a25343e) Thanks [@bastionstack](https://github.com/bastionstack)! - Align the login flow with the latest Figma designs: load `branding.font_url` at document level so branded fonts (including the heading face) actually render, change the sign-in CTA from "Continue" to "Sign in", add the missing `identifier.field.password` label, drop the sign-up subheadline, and rename the passkey registration action to "Continue with a passkey". The default login flow no longer shows the post-registration passkey upsell screen — passkey registration is offered up front instead.

## 0.1.0-alpha.4

### Patch Changes

- [#279](https://github.com/zitadel/nextgen/pull/279) [`ce237ef`](https://github.com/zitadel/nextgen/commit/ce237ef355422c666769eef20df78bdc8ec0e0f9) Thanks [@fforootd](https://github.com/fforootd)! - Harden local setup guidance, Next 16 scaffolding, and login form automation.

## 0.1.0-alpha.3

## 0.1.0-alpha.2

### Minor Changes

- [#266](https://github.com/zitadel/nextgen/pull/266) [`01aed1e`](https://github.com/zitadel/nextgen/commit/01aed1e0de4ffd1ec6d78f8fa73f0ce19b907aa0) Thanks [@mridang](https://github.com/mridang)! - Allow configuring `<zitadel-login>` and `<zitadel-logout>` declaratively from HTML via `project-id`, `proxy-path`, and `url` attributes, so the components work on a plain page without JS or `configureZitadel()`. Configuration resolves in this order, highest first: the `project` property, then the `configureZitadel()` global, then the HTML attributes. The existing JS paths still win — the attributes are the no-JS fallback.

  Also fix the standalone bundle so it loads in a browser: it was built for Node and emitted an `import "node:module"` that browsers cannot resolve. It is now built for the browser, so `dist/standalone.mjs` is genuinely self-contained.

- [#261](https://github.com/zitadel/nextgen/pull/261) [`09aa2b1`](https://github.com/zitadel/nextgen/commit/09aa2b13da9dd0e15453f46f4d62fb2863835a0c) Thanks [@mridang](https://github.com/mridang)! - Add a standalone browser bundle (`dist/standalone.mjs`) so the components work on a plain HTML page via `<script type="module">` with no import map or bundler. Exposed via the `./standalone` export and `unpkg`/`jsdelivr`.

### Patch Changes

- [#231](https://github.com/zitadel/nextgen/pull/231) [`ce89c59`](https://github.com/zitadel/nextgen/commit/ce89c5941b4ae90849fac720ecc4a2a0c49c245d) Thanks [@bastionstack](https://github.com/bastionstack)! - Tidy the web components package: align README/AGENTS docs with the real SDK-config API, adopt idiomatic Lit patterns (`classMap`, `live()`, `ifDefined`, `@query`, a shared `emit()` helper), make post-step focus deterministic via `updateComplete` instead of `requestAnimationFrame`, centralise SDK/API resolution in a `resolveApi()` helper, correct the manifest registry (e.g. `zl-passkey` `method` attribute), and expand unit/browser test coverage.

- [#253](https://github.com/zitadel/nextgen/pull/253) [`c097a5f`](https://github.com/zitadel/nextgen/commit/c097a5f0b720e58920c692ec909960e9c44696e3) Thanks [@vitorbari](https://github.com/vitorbari)! - Add English labels for the `givenName`, `familyName`, and `dateOfBirth`
  fields the default register step now collects.

## 0.1.0-alpha.0

### Minor Changes

- [#45](https://github.com/zitadel/nextgen/pull/45) [`c82ed55`](https://github.com/zitadel/nextgen/commit/c82ed5564e949bf8fe73f449db9a2718b50e7edf) Thanks [@bastionstack](https://github.com/bastionstack)! - Add the first publishable surface of `@zitadel/components`:
  - The Lit-based atom substrate (`<zl-field>`, `<zl-submit>`, `<zl-action>`, `<zl-error>`) with manifests, parts, slots and the `zl-input` / `zl-submit` / `zl-action` CustomEvents that the orchestrator listens for.
  - A `--zl-*` token catalogue, base shadow-host styles and a focus-ring helper consumed by all atoms.
  - The `<zitadel-login>` orchestrator: open Shadow DOM, branding-to-tokens via `adoptedStyleSheets` (light/dark), pluggable `FlowTransport` (`FetchTransport`, `FixtureTransport`), DOMPurify allowlist for `zl-*`, font-url loader, branding shape validator, and a LiquidJS engine with banned `| raw`, the `| t` filter and the `{% mandatory_gates %}` patcher.
  - Bundled `default.liquid` + `auth_form.liquid` partials for centered and split layouts, plus an `en` locale stub.
  - Subpath exports for `./atoms`, `./manifests`, `./tokens`, `./orchestrator` and `./orchestrator/transport`.

- [#86](https://github.com/zitadel/nextgen/pull/86) [`0fa3fc9`](https://github.com/zitadel/nextgen/commit/0fa3fc9a5ec7f85f8d5ab771737e87decab8b404) Thanks [@bastionstack](https://github.com/bastionstack)! - Wire `<zitadel-login>` and `<zitadel-logout>` to the orval-generated
  `@zitadel/api` typed fetch client and consolidate flow mocking
  into the new workspace-internal `@zitadel/api-mock` package.

  The previous `FlowTransport` abstraction (and its `FetchTransport` /
  `FixtureTransport` / `WalkingFixtureTransport` / `ProxyTransport`
  implementations) is gone. So is the wire/internal type split — the
  orchestrator stores the orval `CreateFlow201` directly and the
  `adaptResponse` boundary is gone. Tests intercept at the network layer
  with MSW.

  Removed exports from `@zitadel/components` (and the
  `./orchestrator` subpath barrel):
  - `FetchTransport`, `FixtureTransport`, `WalkingFixtureTransport`,
    `ProxyTransport`
  - `FlowTransport`, `FlowTransportError`, `FixtureScript`,
    `FetchTransportOptions`, `ProxyTransportOptions`,
    `WalkingFixtureOptions`
  - `FlowDefinition`, `FlowDefinitionStep`, `FlowTransitionTarget`,
    `StartInput`
  - `FlowApiResponse`, `StartFlowInput`, `SubmitFlowInput`,
    `FlowStartInput`, `FlowSubmitInput`, `FlowResponse`, `FlowStep`,
    `FlowField`, `FlowAction`, `FlowGate`, `FlowSsoProvider`,
    `FlowFieldType`, `FlowPurpose`, `FlowStepComplete` — the wire shape
    comes from `@zitadel/api/generated/model` directly; consumers
    who need it should import from there.
  - The `@zitadel/components/orchestrator/transport` subpath
    export.

  Retained exports (now sourced from the dedicated `branding.ts` and
  `template-context.ts` modules):
  - `Branding`, `BrandingPalette`, `BrandingShape`, `BrandingTheme`,
    `BrandingTypography`, `BrandingAssets`, `FlowLayout`,
    `BrandingValidationResult`.
  - `FlowMessage`, `FlowIdentity`, `FlowError`, `LiquidContext` — the
    Liquid template context contract for tenant templates.

  Removed attributes/properties on `<zitadel-login>`:
  - `transport`, `base-url`, `proxy-base`. Configure the API base URL
    with `setApiBaseUrl()` from `@zitadel/api/runtime/base-url`,
    or use the new `api-base` attribute for declarative setups. A new
    `resume-flow-id` attribute resumes an existing flow handle.

  Removed attribute on `<zitadel-logout>`:
  - `proxy-base`. The element now calls the typed `endSession`
    operation (`GET /auth/end-session`) and forwards `client-id` /
    `post-sign-out-url` as query parameters.

  Behaviour changes:
  - `<zitadel-login>` emits a new `zitadel-flow-complete` CustomEvent on
    terminal steps with `{ behavior, redirect_uri?, handoff_token? }`.
    For `complete: "redirect"` it follows `redirect_uri`; for
    `complete: "show"` it falls back to the optional `post-sign-in-url`.
  - The submit body now matches the OpenAPI contract:
    `{ session_token, action, fields, gate_proofs?, sso_provider_id? }`
    posted to `/flow/{id}/submit`. The orchestrator re-reads the `id`
    from every response to track flow pivots and pops, and runs all
    calls with `credentials: "include"` so the stateless `_zflow`
    cookie round-trips.

  Mocking workflow:
  - The dev playground and unit tests both consume
    `@zitadel/api-mock` (`setupMock` for browser worker
    callers, `setupMockHandlers` for `msw/node`). The mock walks an
    `xstate` flow machine through identifier → password → done (with
    register and SSO branches) and exposes `applyBranding`,
    `getCapturedRequests`, and `resetFlow` helpers. The previous
    hand-rolled `dev/mock-flow-server.ts` is gone.

- [#73](https://github.com/zitadel/nextgen/pull/73) [`b118f74`](https://github.com/zitadel/nextgen/commit/b118f742cbd9e21cbb4616f36386f09f72a3cc69) Thanks [@bastionstack](https://github.com/bastionstack)! - Replace the `@nextgen/ui-lit` placeholder web components with the real
  `@zitadel/components` library across the demos and SDK packages.
  - Add `<zitadel-logout>`: an orchestrator-tier element built on the same
    design-token system as `<zitadel-login>`. It reads the `__nextgen_display`
    cookie, renders an avatar trigger + dropdown by default, and supports a
    `<template>`-slot mode with `{{name}}`, `{{email}}`, `{{initial}}`
    substitutions and `data-action="logout"` triggers. Fires `zitadel-signout`
    on completion.
  - Add `proxy-base` and `post-sign-in-url` attributes to `<zitadel-login>`.
    When `proxy-base` is set the orchestrator drives a new `ProxyTransport`
    against the SDK's `/__nextgen` proxy; `post-sign-in-url` navigates after a
    terminal step. `<zitadel-logout>` exposes `proxy-base` and
    `post-sign-out-url` for the symmetric flow.
  - Add `ProxyTransport`: a same-origin transport that speaks the
    `/v1/flow {action,email,password}` shape exposed by the
    `feat/sdk-packages` mock server / SDK proxy. Synthesises a single-step
    `FlowResponse` with `email` + `password` fields so the existing
    orchestrator + atom pipeline renders against it unchanged.
  - Drop the `@nextgen/ui-lit` package and switch `@zitadel/sdk-next`,
    `@zitadel/sdk-nuxt`, and the `apps/demo-next` / `apps/demo-nuxt` apps to
    re-export and consume `@zitadel/components` instead. Existing
    `<nextgen-login>` / `<nextgen-logout>` tags become `<zitadel-login>` /
    `<zitadel-logout>` with the same `proxy-base` and post-sign-{in,out}-url
    attributes.

- [#116](https://github.com/zitadel/nextgen/pull/116) [`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba) Thanks [@bastionstack](https://github.com/bastionstack)! - Introduce the design-token-driven foundation for the auth surface, replacing
  the demo styling baseline:
  - New `@zitadel/design-tokens` package — the single producer of the
    `--zl-*` CSS variable layer, the typed `tokens` / `cssVars` constants,
    and the Tailwind v4 `@theme` block. Backed by a version-pinned
    `figma-tokens.lock`, a Figma REST sync script, and a manual-trigger
    GitHub workflow that opens PRs with regenerated outputs. A snapshot
    test locks the public token surface.
  - New `@zitadel/ui-react` package — visually identical paired React components
    of every Lit atom (`<Button>`, `<TextField>`, `<Alert>`, `<Pill>`,
    `<Icon>`, `<Card>`, `<PageShell>`). Used by the internal Zitadel console
    and ships a single `styles.css` that consumes the design-token variables.
  - `@zitadel/components`:
    - Drop the legacy `<zl-submit>`, `<zl-action>`, `<zl-error>` atoms and
      the hand-rolled `src/tokens/` catalogue.
    - Add `<zl-button>` (full Figma matrix, form-associated), `<zl-alert>`,
      `<zl-pill>`, `<zl-icon>`, `<zl-card>`, `<zl-page-shell>`. Rebuild
      `<zl-field>` against the Figma Text Field spec.
    - Add `passkey-upsell` and `signed-in` Liquid templates and rewrite the
      default + auth-form templates to compose `<zl-page-shell>` →
      `<zl-card>` with the new atoms.
    - Rewrite `branding-to-tokens` to fan branding palette/density/radius
      onto the new `--zl-*` namespace and add `branding.attribution` for
      "Secured with Zitadel" footer control. Default theme switches from
      light to dark to match the published Figma variable mode.

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Wire up the end-to-end passkey registration and login flow across the
  API, component, and SDK surfaces:
  - `@zitadel/api`: expose the passkey registration OpenAPI contract to the
    generated TypeScript client.
  - `@zitadel/components`: refresh the `<zl-passkey>` atom and the
    `<zitadel-login>` orchestrator templates (consolidated `default.liquid` +
    `layout-chrome.css`, dropped the standalone passkey-upsell/signed-in
    partials) and expand the `en`/`de` locale strings for the passkey steps.
  - `@zitadel/sdk-next`: extend `auth` and the request `middleware` to drive the
    passkey register/login round-trip.
  - `@zitadel/sdk-core`: adjust JWT handling to support the flow.

- [#209](https://github.com/zitadel/nextgen/pull/209) [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703) Thanks [@bastionstack](https://github.com/bastionstack)! - Rename the public packages to the `@zitadel` scope and publish them to npm via changesets with GitHub OIDC trusted publishing. This is the first `@zitadel/*`-scoped release line, cut as an `alpha` prerelease.

### Patch Changes

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Document the default fresh-app credential journey and refine the component copy
  and password autocomplete behavior for registration flows.

- [#223](https://github.com/zitadel/nextgen/pull/223) [`8a8d417`](https://github.com/zitadel/nextgen/commit/8a8d417923754d58c3967839ebc9ebf84154531b) Thanks [@peintnermax](https://github.com/peintnermax)! - exchange auth header and form-associated name property
