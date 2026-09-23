# Demo script: one command for the whole dev loop

A ten minute walkthrough of `zitadel run`: the local Zitadel server and the
app's own dev server started together in one terminal, their logs interleaved,
and the project's configuration reapplied on a keystroke.

The story to tell: **the dev loop is one command, and config is one keystroke
away from the running server.**

Where the `poc/hot-reload` branch attacks this from the server side (the
`configfs` dialect reads `.zitadel/**` directly, so a file edit needs no upload
at all), this attacks it from the CLI side: nothing about the server changes,
the upload still happens, it just stops being a context switch. The two
compose, see [What is deliberately not in this demo](#what-is-deliberately-not-in-this-demo).

> This runs from a source checkout of the `poc/hot-reload-cli` branch. The
> published `@zitadel/cli@alpha` does not have `run` yet, so `npx` will not do.

## Before the demo

Do all of this ahead of time. None of it is interesting to watch, and the first
`workspace:cli` invocation packs and publishes every workspace package to a
local Verdaccio registry, which takes minutes.

```sh
cd ~/source/github/zitadel/nextgen
git switch poc/hot-reload-cli

corepack pnpm install --frozen-lockfile
GOTOOLCHAIN=go1.26.0 moon run server:build
```

`moon` must be run from the repository root. The `GOTOOLCHAIN` pin is needed
because `ogen` generation panics on Go 1.27. The install is not optional: the
CLI wrapper refuses to run when `node_modules` is older than `pnpm-lock.yaml`.

Pick a scratch directory for the demo app and keep it out of the repository:

```sh
export DEMO=/tmp/zitadel-run-demo
rm -rf "$DEMO" && mkdir -p "$DEMO"
```

Free port 8080 before you go further. A `moon run workspace:server` from this
checkout holds it, and so does any other Zitadel you left running:

```sh
lsof -iTCP:8080 -sTCP:LISTEN -P -n
```

`zitadel stop --all` only sweeps CLI-managed runtimes (the ones storing data in
a project's `.zitadel/local/nextgen-data`), so it will not stop a source-built
`dist/server/nextgen`. Stop that one yourself, or keep it and give the demo its
own port: add `--port 8099` to both `start` and `run` below. `setup` needs no
flag either way, it reads the port back out of the runtime file, and the rest
of this script then reads `8099` wherever it says `8080`.

Scaffold the app now, on your own time. A developer does this once, and it is
not what the demo is about:

```sh
moon run workspace:cli -- start --cwd "$DEMO"
moon run workspace:cli -- setup --server local --cwd "$DEMO"   # answer: Next.js, defaults
moon run workspace:cli -- stop --cwd "$DEMO"
```

`stop` matters: it leaves the demo with nothing running, so the first thing the
audience sees is one command bringing the whole stack up.

Then do a full dry run of everything below once, delete the directory, and do
it again on stage. The second run reuses the local registry and is much faster.

Two terminals, both with `DEMO` exported:

| Terminal | Purpose                                     |
|----------|---------------------------------------------|
| 1        | the `run` session, and nothing else         |
| 2        | editing `.zitadel/**` and `.env.local`      |

That table is the demo. Before this command it was three terminals: the server,
the app's dev server, and one to type `zitadel apply` in.

## 1. One command

Terminal 1:

```sh
moon run workspace:cli -- run --cwd "$DEMO"
```

```text
Console: signed in as admin@zitadel.localhost. Open this link (works once):
http://localhost:8080/ui/console/?...
zitadel │ Local Zitadel server ready at http://localhost:8080
zitadel │ Applying config to http://localhost:8080
zitadel │ Config already in sync.
zitadel │ Starting the app dev server: pnpm dev

Keys  r apply  ·  R apply + restart server & app  ·  q quit

app     │   ▲ Next.js 16.0.1
app     │   - Local:  http://localhost:3000
server  │ level=INFO msg="server listening for requests" address=:8080
```

A few things to point out before moving on:

- **The prefix column.** `server` is the Zitadel server, `app` is the
  framework's dev server, `zitadel` is the session narrating itself. Output is
  buffered per source and printed a line at a time, so two processes writing at
  once never interleave mid-sentence.
- **The key hint.** It is printed once, at startup. `h` reprints it.
- **It applied already.** A `run` session applies the repo config once on the
  way up, so the server you are about to use matches the files in the project.
  `--no-apply` turns that off.
- **The console link.** It is unprefixed because it comes from the same start
  path `zitadel start` uses, before the session takes over the output. Open it
  if you want the console alongside the app; it works once.

The session boots the server itself. If one was already running it says
`already running` instead, adopts it, and leaves it running when the session
ends: `run` stops only what it started.

## 2. Prove the stack works

Open <http://localhost:3000/login>. Use exactly `localhost`, not `127.0.0.1`
and not the Network URL Next.js prints, because preview origins are exact match
and WebAuthn RP IDs are hostname based.

In the browser:

1. **Register** -> email `ada@example.com` -> **Submit**
2. set a password -> **Submit**
3. skip the passkey offer if it appears
4. you land on `/profile`, signed in

Watch terminal 1 while you do it. The app's route rendering and the server's
request handling scroll past in one place, which is the other half of why this
command exists: when a login fails, the two halves of the answer are already
next to each other.

Note what the registration form asked for: an email address, and nothing else.
That is the whole of `properties` in the default schema.

## 3. Add a required field, then press `r`

Terminal 2. Two files change, and it is worth being explicit about why: the
schema says what a user **is**, the flow says what the login UI **asks for**.
They are separate resources on purpose, so adding a field the UI must collect
means editing both.

`.zitadel/schemas/default-human-user.json` gets the property, and the property
gets marked required:

```json
"required": [
  "email",
  "department"
],
"properties": {
  "email": {
    ...
  },
  "department": {
    "type": "string",
    "description": "The department the user belongs to."
  }
}
```

`.zitadel/flows/default-login.json` lists it in the `register` step's `fields`:

```json
{
  "name": "register",
  "fields": [
    "email",
    "department"
  ],
  ...
}
```

Now go back to terminal 1 and press **`r`**. Do not run a command. Do not
switch directories. One key:

```text
zitadel │ Applying config to http://localhost:8080
zitadel │ Applied 2 changes, updated 2 local files.
```

(The counts vary with what you edited. The schema change publishes a new
revision, the flow is re-pinned to it, and both files are rewritten from the
server's canonical response, which is why local files are updated too.)

Back in the browser, **open a fresh registration**:
<http://localhost:3000/login>, then **Register**. The form now asks for
**Email** and **Department**, with Department required.

Register `grace@example.com` with a department, set a password, land on
`/profile`. Two users now exist under two versions of the schema, and
`ada@example.com` still signs in fine: that account predates the field and is
not retroactively invalid.

Worth saying out loud: `r` is not a demo path. It runs the same sync engine
`zitadel apply` runs, against the same server, with the same validation and the
same write-back. If the config is invalid, the session prints the same
`E_VALIDATION` you would get from `apply` and stays open so you can fix it and
press `r` again.

## 4. Change something the running server cannot pick up, then press `R`

Server configuration is read at boot, not per request. The CLI hands every
`NEXTGEN_*` variable in `.env.local` and `.env` to the runtime when it starts
it, so changing one needs a restart. That is what the capital key is for.

Terminal 2, in `$DEMO/.env.local`:

```sh
NEXTGEN_INSTRUMENTATION_LOG_LEVEL=DEBUG
```

Terminal 1, press **`R`**:

```text
zitadel │ Restarting the local Zitadel server
zitadel │ Local Zitadel server ready at http://localhost:8080
zitadel │ Applying config to http://localhost:8080
zitadel │ Config already in sync.
zitadel │ Restarting the app dev server: pnpm dev
server  │ level=INFO msg="structured logger configured" config_level=DEBUG
app     │   ▲ Next.js 16.0.1
```

The order is deliberate: the app is stopped first, the server is replaced, the
config is applied against the fresh server, and only then does the app come
back, so the dev server never talks to a half-configured instance.

`server │` lines are noticeably chattier from here on, which is the proof that
the restarted process read the new value. Sign in once more if you want to see
debug output for a real request.

## 5. End the session

Press **`q`** (or Ctrl-C, which the session catches for you even though raw
mode has taken it away from the terminal):

```text
zitadel │ Shutting down
Zitadel run session ended.

Next:
  The local Zitadel server was stopped; its data was kept.
```

Show that both halves really are gone, and that nothing was lost:

```sh
moon run workspace:cli -- status --cwd "$DEMO"   # server lifecycle: stopped
ls "$DEMO/.zitadel/local/nextgen-data"           # the database is still there
```

Start the session again and both users are still there. The session owns the
processes, not the data.

## Closing

The point to land: this is not a new runtime, a watcher, or a daemon. It is the
three commands a developer already runs, put in one place, with the one that
used to require a context switch moved onto a key. Nothing about the server
changed, which is also why it can ship without waiting for the `configfs` work
on `poc/hot-reload`.

## Optional: the agent's view

An agent cannot press a key, so the session refuses to stream under `--json`
and says what to use instead:

```sh
moon run workspace:cli -- run --cwd "$DEMO" --json
# E_VALIDATION: Cannot stream a run session with --json
# next: zitadel start --json, zitadel apply --json
```

The plan is still available as a normal envelope, which is how an agent or a CI
check inspects what a session would do:

```sh
moon run workspace:cli -- run --cwd "$DEMO" --json --dry-run | jq '.data'
```

```json
{
  "runtime": { "backend": "binary", "port": 8080 },
  "app": { "command": "pnpm dev", "port": 3000 },
  "apply_on_start": true,
  "keys": { "r": "...", "R": "...", "q": "...", "h": "..." }
}
```

## If something goes wrong

| Symptom | Usually |
|---|---|
| `workspace dependencies are missing or older than pnpm-lock.yaml` | `corepack pnpm install --frozen-lockfile` was skipped. The CLI wrapper refuses to pack a stale workspace. |
| `E_PORT_IN_USE` on 8080 | Another Zitadel is already listening. `zitadel stop --all` clears CLI-managed runtimes only, so a source-built `dist/server/nextgen` (`moon run workspace:server`) has to be stopped by hand. Otherwise use `--port 8099` on both `start` and `run`, and read the next row. |
| `Config applies to http://localhost:8080, not the local server this session started` | The project was set up against a different port than the session is running on. Use the same port everywhere, or add `--server local` so applies follow the session's own server. |
| Keys do nothing | stdin is not a terminal. The banner says `Not a terminal: keys are unavailable` at startup when that is the case, which happens when the output is piped or captured. Ctrl-C still works. |
| `App dev server exited (code 1)` | The `dev` script failed on its own. The session stays up on purpose: fix it and press `R`. |
| `No .zitadel/secret here` | Wrong `--cwd`, or `setup` was never run in it. The server and the app still start; only applying is skipped. |
| `Could not create a console sign-in link` | The local admin is missing from that data directory. Harmless here, the session continues; it only costs you the one-click console link. |
| `E_FRAMEWORK_NOT_DETECTED` during prep | `--non-interactive` in an empty directory. Either answer the prompts or pass `--framework next`. |
| moon reports a workspace error | `moon` was run from inside `$DEMO`. Run it from the repository root. |

## What is deliberately not in this demo

- **No file watching.** `r` is a keystroke, not a watcher, and that is a
  decision rather than a gap: every apply publishes immutable schema and flow
  revisions, so an editor autosaving on every keystroke would publish a
  revision per keystroke. A watcher needs a debounce and a revision story
  first.
- **The `configfs` dialect.** On `poc/hot-reload` the server reads `.zitadel/**`
  as its store, so the resources this demo uploads with `r` would need no
  upload at all. The two are complementary: with `configfs` in place, `r`
  becomes unnecessary for schemas, flows and branding, while `R` still covers
  everything a running process cannot reread (env vars, dependencies, framework
  config).
- **More than one app.** One `dev` script per session. A monorepo with two apps
  runs two sessions, or one session with `--no-app` beside its own dev servers.
- **Health supervision.** If the server dies mid-session, the session does not
  notice and restart it for you. Its output is in the `server` stream, and `R`
  brings it back.
- **The Docker backend.** `--runtime docker` works and streams `docker logs`
  instead of the log file, but the demo uses the default npm binary runtime.
