# Cloud containers plan, 2026-10-10: the server as a container image on Vercel

> **History:** the containers plan of 2026-10-10 with phase A's results, kept as written for its reasons and
> measurements. The cloud as it stands is [the cloud's README](../README.md);
> the decisions this led to, with their reasons, are in
> [decisions.md](../decisions.md). Paths named here may have moved since;
> the routing POC (`apps/cloud/routing-poc/`) was removed on 2026-10-10, and
> systems, a customer's own database, left the code the same night
> ([C43](../decisions.md#c43)).

The regional servers, the home and the control plane move from Vercel's Go
preset to container image functions: first built by Vercel from a
`Dockerfile.vercel` (the POC), then from the image CI publishes. Decided on
2026-10-10 after reading Vercel's notes on
[migrations at container startup](https://vercel.com/i/database-migrations-container-startup),
[seven ways to use containers](https://vercel.com/i/7-ways-to-use-docker-containers-on-vercel)
and the [SIGTERM contract](https://vercel.com/docs/functions/functions-api-reference#sigterm-signal).
It reverses the 2026-10-09 decision in
[2026-10-07-preview-cloud-journal.md](2026-10-07-preview-cloud-journal.md)
("The Go runtime after all"), which was right on the facts it had: the
container lost on build time and cold start. The facts that changed are
below.

## 0. Why

- **Graceful shutdown.** `SIGTERM` is delivered to Node, Bun, Rust and
  Python functions, with 500 ms to react, and to container images with
  **30 seconds**. The Go preset is not on the list: the server we run today
  gets no signal when Vercel scales an instance in. The server already
  handles `SIGTERM` (`signal.NotifyContext`, a 15 s HTTP shutdown, then the
  deferred `Close()` of the request audit buffer and the event shipper), so
  in a container every scale-in drains; on the Go preset it can lose the
  batch in flight. For an audit product that is the deciding fact.
- **One artifact.** The image CI releases (`ghcr.io/zitadel/nextgen`) is
  what self-hosters run; the cloud running the same bits removes the Go
  compile on Vercel, the `@vercel/go` proxy binary and the Build Output we
  emit by hand.
- **Bindings.** Container services may declare bindings; Go-runtime
  services may not. The control plane reaching the regions, and the regions
  reaching the home, on Vercel's internal network removes the protection
  bypass header from every internal call.

What the Go preset keeps winning is cold start (about 0.1–1.2 s against
about 2.4 s of container provisioning) and build time when the image is
compiled on Vercel. The keep-warm cron and the five-minute idle window of
production cover the first; the CI image removes the second.

## 1. Facts this rests on (Vercel docs, read 2026-10-10)

- Container images are functions on Fluid compute: stateless HTTP servers
  listening on `PORT` (default 80, overridable in project settings), Active
  CPU pricing, the standard function limits, scale-in after **5 minutes
  without traffic in production and 30 seconds in preview**, `SIGTERM`
  with a 30-second grace period. Beta, all plans.
- A service uses a container by setting `entrypoint` to its Dockerfile,
  relative to the service's `root`; Vercel builds the image on each commit
  and pushes it to the Vercel Container Registry (VCR). Services can also
  carry their own `rewrites`, `routes` and `headers`; the docs say a
  `request.path` transform in a service's `routes` changes the path the
  code observes, but T2 below found that for a container service the
  rewrite itself does that and the transform does nothing there, while a
  hand-written Build Output route with the transform works as it did for
  the preset.
- VCR takes images from standard tooling and from GHCR (OIDC login,
  zstd recommended, 15 GB per image, $0.10 per GB stored); a GitHub Actions
  login action exists.
- **Not supported with custom images:** Secure Compute and Static IPs.
- The container builder itself (`@vercel/container` 17.0.0, read from the
  CLI bundle on 2026-10-10): it passes every string of the build
  environment as a `--build-arg`, so a Dockerfile reads
  `VERCEL_GIT_COMMIT_SHA` through `ARG` and must never declare an `ARG` for
  a secret; it ignores a service's `buildCommand` ("not supported and will
  be ignored"); it builds with `buildah --layers` on a layer store that is
  cold at the first service of a deployment and warm for the next; and it
  accepts a prebuilt OCI image reference in place of a Dockerfile ("a
  prebuilt OCI image reference, or a Dockerfile path to build": no build,
  no push, the reference goes straight into the function's `handler`). The
  CLI's own validation of a service `entrypoint` only lets a Dockerfile
  basename through, but a Build Output `.vc-config.json` with
  `runtime: container` and `handler: <image reference>` is exactly what the
  builder emits, so our hand-written Build Output can point at an image CI
  pushed.
- Vercel's own guidance on migrations matches ours: no schema changes at
  container startup in production; a release step with a versioned
  artifact that stops the release on failure, expand-and-contract, an
  isolated database per preview. The `migrate` service's build step is
  that; it stays.
- Our own record: the container ran in fra1 through PgBouncer on 2026-10-08
  with `pool_max_conns=4` and `default_query_exec_mode=cache_describe`, 24
  concurrent creates clean once the cluster had 50 connection slots; the
  deleted `Dockerfile.vercel` was `FROM ghcr.io/zitadel/nextgen` plus an
  entrypoint rendering the master key into the config. Per-service regions
  were proven for the Go preset through our own `.vc-config.json`, never
  for a container, where Vercel writes that file.

## 2. Target shape

| Service | Today | Target |
|---|---|---|
| `home`, `server_eu`, `server_us` | Go preset, `apps/cloud/build-output.sh`, launcher binary behind the `@vercel/go` proxy | container functions: `build-output.sh` writes a function whose `handler` is the image the `image` service built and whose `environment` carries the role as before; the image's entrypoint runs the launcher (it runs the server in-process and reads `PORT`) |
| `cloud` | same, `apps/cloud/api` | the same image; the entrypoint runs the control plane binary for `CLOUD_ROLE=cloud`; binds the home and the regions |
| `image` (new) | — | `runtime: container`, `Dockerfile.vercel` at the repository root; builds and pushes the one image per deployment, never routed |
| `migrate` | Go preset build step migrating every database | unchanged; also runs the control plane's goose migrations, which today run at the control plane's startup |
| console, docs, storybook, website | static | unchanged |

Routing is unchanged: the top-level rewrites of `vercel.json`, the prefix
strip now as two rewrites in each service's own `rewrites` (T2 below),
the project routing rules of the systems concept on top. The launcher's
environment contract is unchanged (`CLOUD_ROLE`, `CLOUD_PATH_PREFIX`,
`CLOUD_DATABASE_URL_<KEY>`, `CLOUD_REGIONS`, the master key, the bypass
secret until bindings replace it). The role stays where it was, in the
function's `.vc-config.json` environment; what changes is the function's
runtime (`container`) and its handler (an image reference instead of a
binary).

## 3. Phases

### A. POC: the image built by Vercel (1 day)

**Status, 2026-10-10 late evening: done**, except one call of T6 that
needs a signed-in person. The preview cloud runs as containers on
`nextgen-preview-cloud-b4iif38u7-zitadel.vercel.app`, where the smoke test
passes all 15 steps; the Go preset stays where `main` deploys until the
cutover.

The point is to answer the questions Vercel's docs do not, on the throwaway
POC project first, then on the preview cloud.

1. **T2, regions per container service: passed on 2026-10-10** (POC
   project `nextgen-routing-poc`, slot `hello_us_container` at `/usc`,
   `apps/cloud/routing-poc/hello/Dockerfile.vercel`). The service is
   `root: hello`, `runtime: container`, `entrypoint: Dockerfile.vercel`,
   `functions: { "Dockerfile.vercel": { "regions": ["cle1"] } }` while the
   project default stays `fra1`. The container answers from `cle1`:
   `x-vercel-id: sfo1::cle1::…`, `VERCEL_REGION=cle1` inside, and
   `vercel inspect` lists `services/hello_us_container/container (3.02MB)
   [cle1]`. The `functions` key is the Dockerfile path relative to the
   service root; the CLI resolves it per service and writes `regions` into
   the container function's `.vc-config.json` the same way it does for the
   preset. Build: buildah builds the image in about 10 s (`golang:1.26-alpine`
   builder, distroless runtime, 3 MB), pushes it to VCR in 2–3 s, the whole
   deployment takes about 30 s. First request after the deploy 0.68 s end to
   end from California through `cle1`, warm requests 0.09 s.
   **In a container service the prefix strip is not a `request.path`
   transform.** The transform changed nothing for the container in any
   position of the service configuration: in the service's `routes` (regex
   form), on the top-level rewrite that selects the service, or on a
   service rewrite with an identity destination (in a hand-written Build
   Output it is honoured, see step 3). What strips the prefix in a service
   is a plain rewrite in the service's own `rewrites`:
   `{ "source": "/usc", "destination": "/" }` and
   `{ "source": "/usc/(.*)", "destination": "/$1" }`, after which the code
   observes `/` and `/hello/world`. The two-rule form is deliberate: a
   `/usc/:path*` source does not match `/usc/` with a trailing slash, which
   then falls through to the catch-all. The hello container binds port 80
   as root because the POC project sets no `PORT`; the real images run as
   `nonroot`, so `PORT=8080` goes into the project.
2. **The image: one `Dockerfile.vercel` at the repository root, built by
   an `image` service.** Two facts put it there. The builder's context is
   the directory of the Dockerfile, not the service root (`buildah build -f
   <dir>/Dockerfile <dir>`; the first attempt, a Dockerfile per service
   under `apps/cloud/docker/`, failed at `COPY go.mod`), and the CLI
   accepts only a Dockerfile basename as `entrypoint`, so four files cannot
   share the root. The one file compiles the launcher and the control plane
   in a `golang:1.26-alpine` builder stage (`ARG VERCEL_GIT_COMMIT_SHA` for
   the build info, the sources copied directory by directory,
   `apps/cloud/build.sh` for both binaries) into a `debian:12-slim` runtime
   stage with certificates and the release image's user 65532, no
   `ENTRYPOINT`, `CMD` the launcher. The root `.dockerignore`, which
   admitted only `linux/**` and `LICENSE` for the release image, now also
   admits the Go sources; the release Dockerfile copies a prebuilt binary
   and reads none of them. The `image` service (`runtime: container`,
   never routed) builds and pushes the image once per deployment as
   `vcr.vercel.com/zitadel/nextgen-preview-cloud/image:<deployment id>`.
3. **The four server services reference the image.** The documented way
   to give a container service its binary, the `command` key, is rejected
   by the deploy validation of CLI 62.7.0 and 63.1.2 alike ("should NOT
   have additional property `command`"), and nothing in a container's
   environment names its service (the hello probe lists its environment:
   `PORT`, `VERCEL_REGION`, `VERCEL_ENV`, `VERCEL_URL`, the git variables,
   `VERCEL_PROJECT_PRODUCTION_URL`, `SSL_CERT_FILE`, no service name). So
   `home`, `server_eu`, `server_us` and `cloud` keep their shape,
   `framework: vite` with `apps/cloud/build-output.sh` as build command,
   and the script now writes a function whose `.vc-config.json` is
   `runtime: container`, `handler` the image reference above,
   `environment` the role, `regions` the placement, plus the prefix-strip
   routes as before; the Go download, the compile and the `@vercel/go`
   proxy are gone from it. A `command` in `.vc-config.json` is not
   honoured either: the first deployment ran the image's default binary
   for the control plane, which refused `CLOUD_ROLE=cloud`. The image's
   entrypoint (`apps/cloud/entrypoint.sh`) therefore picks the binary from
   `CLOUD_ROLE`, the control plane for `cloud` and the launcher for the
   rest, and `exec`s it so that `SIGTERM` reaches the binary. Proven on the POC first (slot
   `hello_us_prebuilt` at `/usp`, `apps/cloud/routing-poc/build-prebuilt.sh`):
   the image referenced by tag, the environment applied (`SLOT`), the
   region applied (`cle1`), and the `request.path` transform honoured in a
   hand-written Build Output, which it is not in a service's own `routes`
   or `rewrites`. `VERCEL_DEPLOYMENT_ID` is in the build environment, so
   the tag is known. `PORT=8080` is set for Preview; Production gets it at
   the cutover, because the Go preset's proxy owns the port there until
   then. `CLOUD_IMAGE` replaces the reference, which is how a CI-built
   image takes over in phase B. One more fact from the first full build: a
   CLI upload from the worktree carries no git metadata in its build and
   runtime environment (the image's build info says `commit unknown`, and
   the migrate step could not name a preview schema and failed the build),
   so the launcher now takes `CLOUD_SCHEMA` for previews, passed as `-e`
   and `--build-env`, while Git deployments keep deriving `pr_<id>`. The
   image itself: module download and the compile of both binaries in
   about 45 s, the whole image in 90 s, the push in 2.6 s.
4. **T4, the drain: passed.** After one request each, the home and both
   regions were scaled in 38 to 47 seconds later (the preview's 30-second
   idle window), and each logged "server shut down" and then "shut down
   application" one millisecond apart. Between the two lines the deferred
   closes run: the shipper's, the retention job's, and the audit request
   buffer's, which waits for its flush and warns when it times out; no
   warning appeared. On the Go preset this code does not run, because the
   platform sends that runtime no signal. The control plane had no signal handling at all (a bare
   `http.ListenAndServe`); it now shuts down the same way, since a create
   interrupted between the region's claim and the placement record would
   leave a project the directory does not know.
5. **T5, numbers: measured.** Build: the image builds in 74–90 s on a
   cold layer store (module download and two compiles) and pushes in
   2.6 s; a whole CLI deployment of the ten services takes about three and
   a half minutes from upload to ready. Cold start, from California:
   2.1–2.5 s end to end for a server in fra1, of which 2.1–2.3 s pass
   before the server logs its first line (the platform provisioning the
   container) and 0.15 s are the server's own boot; 0.7–1.3 s for cle1;
   3.0 s for the control plane, which still migrates at startup. Warm
   requests take 0.2 s. P1 against `/eu/projects/{id}` (token check, authz
   check, project read; pools of 4 through PgBouncer): no failures at 50,
   100 and 200 concurrent. Starting from idle the median is the Go
   preset's, 0.20 s, but p95 reaches 1.1–1.8 s and p99 2.1–2.3 s: every
   instance added under load provisions for about two seconds. Run again
   while warm, 200 concurrent gives 590–760 requests per second, p95
   0.50–0.53 s and p99 0.68–0.71 s, against the Go preset's 540 per second,
   p95 0.90 s and p99 1.44 s in the morning's baseline (warmth not
   recorded). The steady state is at least as good; a burst that needs new
   instances pays the cold start, which production's five-minute idle
   window and the keep-warm cron mostly hide.
6. **T6, bindings: passed for every call that needs no signed-in person.**
   `cloud` binds `home`, `server_eu` and `server_us`; both regions bind
   `home` (`vercel.json`; the control plane reads `CLOUD_REGION_URL_<ID>`,
   the launcher leaves a bound `NEXTGEN_PLATFORM_HOME_URL` alone). Proven
   on the POC first (the hello probe's guarded `/_call/` endpoint): the
   binding URL is `https://<service>.<project id in hex>.services.vercel-infra.com`,
   one per project and service, and a call reaches the caller's own
   deployment (target and caller deployment ids equal); it enters the
   target service's own route table, so the prefix strip applies
   (`/usc/hello` arrives as `/hello`); bindings declared on a service built
   as a hand-written Build Output reach its container functions; warm
   calls take 15–75 ms within cle1 and 130–210 ms from cle1 to fra1. In the
   cloud preview, a made-up session cookie sent to `/cloud/me/projects`,
   `/eu/sessions/me` and `/us/sessions/me` reached the home's
   `/sessions/me` on its binding host each time (the home's own log),
   past deployment protection, with no bypass secret configured, and the
   control plane and both regions log the binding URL as their home, and
   the control plane logs both regions as reached over bindings
   (`regions_over_bindings=2`). The
   binding host is not reachable from outside: it resolves publicly to
   192.0.2.1, a reserved documentation address, and a request from the
   internet times out, so a binding does not open a protected preview to
   the world. Not
   yet exercised: the control plane's create through a region binding
   (`POST /cloud/projects {name, region}`), which needs a signed-in
   person; the console does not call it yet.

Costs measured in this phase: one image build per deployment (74–90 s)
instead of a Go compile per service, and the container cold start (about
2.2 s in fra1). Phase B removes the first.

### B. The image from CI (1–2 days)

1. **CI publishes per commit.** A job in `ci.yml`, next to the release
   snapshot that already cross-compiles the server, builds and pushes
   `ghcr.io/zitadel/nextgen:sha-<commit>` (and `main` on main), linux/amd64,
   zstd. Releases keep publishing `<version>` through `release-publish`.
   Whether the launcher ships inside that image or as a second small image
   (`nextgen-cloud`) is decided here: the launcher is cloud-only code, so a
   second image built from the first is the clean cut.
2. **Dockerfiles become one line plus `ENV`:** `FROM ghcr.io/zitadel/nextgen-cloud:${TAG}`.
3. **T3, the tag: answered in phase A.** The build environment reaches the
   Dockerfile as build args, so `ARG VERCEL_GIT_COMMIT_SHA` names the
   per-commit image. What remains is the order of events: Vercel builds on
   the push, CI's image lands minutes later. Two shapes to test: the
   `FROM` line waiting for the tag (a loop in the builder stage against
   VCR, bounded by the build's time limit), or the deployment triggered by
   CI after the push (a deploy hook, Git deployments off for the server
   services), which also lets the hand-written Build Output name the image
   by digest in `handler` and skip the image build on Vercel altogether.
4. Build time drops to a pull and a push; the Go toolchain download and
   `build-output.sh` leave the regional services (the `migrate` step keeps
   compiling, or downloads the release binary).

### C. Cleanup and bindings (½ day)

- Regions call the home and the control plane calls the regions over
  bindings; `CLOUD_HOME_BYPASS_SECRET` disappears from internal calls
  (bindings grant reachability, not authentication; the auth plan's tokens
  remain the authentication).
- The control plane's startup migration moves into the `migrate` step.
- `apps/cloud/build-output.sh` and the proxy download are deleted for the
  server services; the design note records the reversal and its reasons.

## 4. What this does not change

The routing contract and last night's POC results, the auth plan, the
triggered mode for background work (a container is still not always-on:
five idle minutes, then scale-in), the PgBouncer settings, the launcher's
environment contract, migrations as a release step.

## 5. Risks

| Risk | Handling |
|---|---|
| Per-service regions unsupported for containers | Closed: T2 passed on 2026-10-10 (phase A, step 1) |
| Container runtime is beta | The preset stays deployable from the same `vercel.json` until phase B is done |
| Cold start: 2.1–2.5 s in fra1 (T5), p99 about 2 s while scaling out | Keep-warm cron, five-minute idle window in production; the warm path is as fast as the preset |
| Image build per deployment, 74–90 s | Accepted; phase B removes it |
| No Secure Compute or Static IPs with custom images | Irrelevant today (public PlanetScale endpoints); a customer needing IP allowlists is a project-per-placement question anyway |
| Image size and registry cost | Slim runtime image, well under 100 MB; $0.10 per GB stored |
