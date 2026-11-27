# language: en
# Sibling to applications-create-plan.md — executable acceptance for #3294.
# Canvas "--no-input" ≡ CLI "--non-interactive" (no --no-input flag or alias).
# Canvas write "--env-file" ≡ CLI "--application-env-file".
# Post-logout / --post-logout-uri is out of v1 (never asserted as asked).

@applications-create @issue-3294
Feature: zitadel application create (registered API client)

  Background:
    Given a reachable Zitadel server
    And the working directory is a project root (--cwd defaults to cwd)
    And ZITADEL_URL and the project credential resolve from the env cascade

  # ---------------------------------------------------------------------------
  # Interactive happy paths
  # ---------------------------------------------------------------------------

  @web @interactive
  Scenario: Interactive create — Website with a backend
    Given ZITADEL_PROJECT_ID is set to "prj_01HEXAMPLE"
    When the developer runs `zitadel application create` on a TTY
    Then the CLI prints "✔ Using project prj_01HEXAMPLE"
    And the CLI asks "What's your product called?"
    When the developer answers "Acme Dashboard"
    Then the CLI asks "What are you connecting first?"
    And the choices are:
      | label                     |
      | Website with a backend    |
      | Browser-only app          |
      | Mobile or desktop app     |
      | Help me choose            |
    When the developer chooses "Website with a backend"
    Then the CLI asks "Sign-in callback URL"
    And the choices include "http://localhost:3000/auth/callback"
    And the choices include "http://localhost:3000/api/auth/callback/zitadel"
    And the choices include "Custom…"
    When the developer chooses "http://localhost:3000/auth/callback"
    Then the CLI asks "Add another redirect URI?"
    When the developer answers No
    Then the CLI does not ask for a sign-out return URL
    And the CLI does not ask "Allowed origin"
    And the CLI asks "Write credentials to a .env file?"
    When the developer answers No
    Then the CLI prints "✔ Created Application Acme Dashboard and its first Client"
    And the CLI prints that the Client is confidential
    And the CLI prints "Client secret" with "(shown only once)"
    And the CLI prints a paste block containing:
      | key                     |
      | ZITADEL_ISSUER          |
      | ZITADEL_CLIENT_ID       |
      | ZITADEL_CLIENT_SECRET   |
      | ZITADEL_CALLBACK_URL    |
    And the CLI prints "Store the client secret on your server now. It will not be shown again."
    And the CLI prints the test checklist starting with "Test it yourself:"
    And no credentials file is written

  @spa @interactive
  Scenario: Interactive create — Browser-only app
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients and allowed origins
    When the developer runs `zitadel application create` on a TTY
    And answers name "Acme Boards"
    And chooses "Browser-only app"
    And chooses sign-in callback "http://localhost:5173/callback"
    And answers No to "Add another redirect URI?"
    Then the CLI asks "Allowed origin"
    When the developer chooses "http://localhost:5173"
    And answers No to "Add another origin?"
    And answers No to "Write credentials to a .env file?"
    Then the CLI prints "✔ Created Application Acme Boards and its first Client"
    And the CLI prints that the Client is "public · PKCE · no secret"
    And the CLI prints "Client secret   none needed. PKCE protects sign-in instead."
    And the CLI prints "Allowed origins" including "http://localhost:5173"
    And the paste block omits ZITADEL_CLIENT_SECRET
    And the paste block includes ZITADEL_ALLOWED_ORIGINS
    And the CLI never asked for a sign-out return URL

  @native @interactive
  Scenario: Interactive create — Mobile or desktop app (custom scheme)
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients and custom-scheme redirect URIs
    When the developer runs `zitadel application create` on a TTY
    And answers name "Acme Tunes"
    And chooses "Mobile or desktop app"
    Then the sign-in callback choices include "com.acme.tunes:/callback"
    And the sign-in callback choices include "http://127.0.0.1/callback"
    When the developer chooses "com.acme.tunes:/callback"
    And answers No to adding another redirect
    And answers No to writing an env file
    Then the CLI prints "✔ Created Application Acme Tunes and its first Client"
    And the CLI prints that the Client is "public · PKCE · no secret"
    And the CLI does not ask "Allowed origin"
    And the paste block omits ZITADEL_CLIENT_SECRET and ZITADEL_ALLOWED_ORIGINS

  @native @interactive
  Scenario: Interactive create — Mobile or desktop app (loopback)
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients
    When the developer creates interactively with preset native
    And chooses sign-in callback "http://127.0.0.1/callback"
    Then creation succeeds with that redirect URI registered
    And the CLI does not ask "Allowed origin"

  # ---------------------------------------------------------------------------
  # Help me choose (taxonomy B → sets --preset only)
  # ---------------------------------------------------------------------------

  @help-me-choose
  Scenario: Help me choose → Website with a backend
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create` on a TTY
    And answers a product name
    And chooses "Help me choose"
    Then the CLI asks "Does sign-in run in a browser, or as an installed app?"
    And the option "Browser" has hint "Users open it at a web address"
    And the option "Installed app" has hint "Users download and install it"
    When the developer chooses "Browser"
    Then the CLI asks "Does your server keep a client secret?"
    And the question description includes "Choose Yes if server code receives it"
    And the option "Yes" has hint "Server code receives the callback and stores a secret"
    And the option "No" has hint "Browser code receives the callback"
    When the developer chooses "Yes"
    Then the CLI prints "✔ Using preset: Website with a backend (--preset web)"
    And the CLI continues with the web sign-in callback prompts
    And no fourth preset value is sent to the API

  @help-me-choose
  Scenario: Help me choose → Browser-only app
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients and allowed origins
    When the developer chooses "Help me choose"
    And chooses "Browser"
    And chooses "No" for "Does your server keep a client secret?"
    Then the CLI prints "✔ Using preset: Browser-only app (--preset spa)"
    And the CLI continues with spa callback and origin prompts

  @help-me-choose
  Scenario: Help me choose → Mobile or desktop app
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients
    When the developer chooses "Help me choose"
    And chooses "Installed app"
    Then the CLI prints "✔ Using preset: Mobile or desktop app (--preset native)"
    And the CLI does not ask "Does your server keep a client secret?"
    And the CLI continues with native callback prompts

  # ---------------------------------------------------------------------------
  # Missing project (env cascade — no picker)
  # ---------------------------------------------------------------------------

  @missing-project @interactive
  Scenario: Interactive — missing ZITADEL_PROJECT_ID prompts and saves
    Given ZITADEL_PROJECT_ID is unset in every cascade source
    And the active environment name is "development"
    When the developer runs `zitadel application create` on a TTY
    Then the CLI asks "What is the value of ZITADEL_PROJECT_ID for the development environment?"
    When the developer answers "prj_01HEXAMPLE"
    Then the CLI prints "✔ Saved to .env.development.local"
    And the file .env.development.local contains ZITADEL_PROJECT_ID=prj_01HEXAMPLE
    And the CLI continues with "What's your product called?"

  @missing-project @no-input @errors
  Scenario: Non-interactive — missing ZITADEL_PROJECT_ID fails without prompting
    Given ZITADEL_PROJECT_ID is unset in every cascade source
    When the developer runs `zitadel application create --preset web --name "Acme" --redirect-uri http://localhost:3000/auth/callback --non-interactive`
    Then the command exits non-zero
    And the error states that ZITADEL_PROJECT_ID is not set for the environment
    And the CLI does not ask any question

  # ---------------------------------------------------------------------------
  # Multi redirect / multi origin
  # ---------------------------------------------------------------------------

  @multi-redirect @no-input
  Scenario: Repeated --redirect-uri (not commas)
    Given ZITADEL_PROJECT_ID is set
    When the developer runs:
      """
      zitadel application create --name "Acme Dashboard" --preset web \
        --redirect-uri http://localhost:3000/auth/callback \
        --redirect-uri https://app.example.com/auth/callback \
        --non-interactive
      """
    Then creation succeeds
    And both redirect URIs are registered on the client
    And a single comma-separated --redirect-uri value is not treated as two URIs

  @multi-redirect @spa @interactive
  Scenario: Interactive add another redirect and another origin
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients and allowed origins
    When the developer chooses "Browser-only app"
    And enters first callback "http://localhost:5173/callback"
    And answers Yes to "Add another redirect URI?"
    And enters "https://boards.acme.com/callback"
    And answers No to adding further redirects
    And enters first origin "http://localhost:5173"
    And answers Yes to "Add another origin?"
    And enters "https://boards.acme.com"
    And answers No to adding further origins
    Then both redirects and both origins are registered

  # ---------------------------------------------------------------------------
  # --non-interactive success
  # ---------------------------------------------------------------------------

  @no-input @web
  Scenario: --non-interactive success — web
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --preset web --name "Acme Dashboard" --redirect-uri http://localhost:3000/auth/callback --non-interactive`
    Then the CLI never prompts
    And creation succeeds with a confidential client and one-time secret
    And the human output includes the .env paste block

  @no-input @spa
  Scenario: --non-interactive success — spa
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients and allowed origins
    When the developer runs `zitadel application create --preset spa --name "Acme Boards" --redirect-uri http://localhost:5173/callback --origin http://localhost:5173 --non-interactive`
    Then the CLI never prompts
    And creation succeeds with a public client and no secret

  @no-input @native
  Scenario: --non-interactive success — native
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients and custom-scheme redirect URIs
    When the developer runs `zitadel application create --preset native --name "Acme Tunes" --redirect-uri com.acme.tunes:/callback --non-interactive`
    Then the CLI never prompts
    And creation succeeds with a public client and no secret

  # ---------------------------------------------------------------------------
  # --non-interactive / missing values (errors)
  # ---------------------------------------------------------------------------

  @no-input @errors
  Scenario: --non-interactive missing --name
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --preset web --redirect-uri http://localhost:3000/auth/callback --non-interactive`
    Then the command exits non-zero
    And the error includes "Missing required flag --name"
    And the CLI does not ask "What's your product called?"

  @no-input @errors
  Scenario: --non-interactive missing --preset
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --name "Acme" --redirect-uri http://localhost:3000/auth/callback --non-interactive`
    Then the command exits non-zero
    And the error includes "Missing required flag --preset"

  @no-input @errors
  Scenario: --non-interactive missing --redirect-uri (empty redirect list)
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --preset web --name "Acme" --non-interactive`
    Then the command exits non-zero
    And the error includes "Missing required flag --redirect-uri (repeat for more)"

  @no-input @errors @spa
  Scenario: --non-interactive spa missing --origin
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --preset spa --name "Acme" --redirect-uri http://localhost:5173/callback --non-interactive`
    Then the command exits non-zero
    And the error includes "Missing required flag --origin (repeat for more; spa only)"

  @no-input @errors
  Scenario: --non-interactive lists every missing required flag at once
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --non-interactive`
    Then the command exits non-zero
    And the error names --name, --preset, and --redirect-uri

  @json @errors
  Scenario: --json with missing values never prompts
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --json`
    Then the command exits non-zero
    And stdout is one JSON envelope with ok false
    And the CLI does not ask any question

  # ---------------------------------------------------------------------------
  # --json success
  # ---------------------------------------------------------------------------

  @json @web
  Scenario: --json success — web envelope
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --preset web --name "Acme Dashboard" --redirect-uri http://localhost:3000/auth/callback --json`
    Then stdout is one JSON envelope with ok true
    And data.application has id and name
    And data.client.preset is "web"
    And data.client.secret is a non-empty string
    And data.redirect_uris is ["http://localhost:3000/auth/callback"]
    And data.allowed_origins is null
    And data.env includes ZITADEL_CLIENT_SECRET
    And data.wrote_env_file is null
    And data has no post_logout fields

  @json @spa
  Scenario: --json success — spa envelope
    Given ZITADEL_PROJECT_ID is set
    And the server supports public clients and allowed origins
    When the developer runs `zitadel application create --preset spa --name "Acme Boards" --redirect-uri http://localhost:5173/callback --origin http://localhost:5173 --json`
    Then data.client.preset is "spa"
    And data.client.secret is null or omitted
    And data.allowed_origins is ["http://localhost:5173"]
    And data.env omits ZITADEL_CLIENT_SECRET

  # ---------------------------------------------------------------------------
  # Env write
  # ---------------------------------------------------------------------------

  @env-write @interactive
  Scenario: Opt-in env write via prompts
    Given ZITADEL_PROJECT_ID is set
    When the developer completes a web create interactively
    And answers Yes to "Write credentials to a .env file?"
    Then the CLI asks "Where should we write them?"
    When the developer accepts the default ".env.local"
    Then the CLI prints "✔ Wrote issuer, client id, secret, and callback to .env.local"
    And .env.local contains ZITADEL_ISSUER, ZITADEL_CLIENT_ID, ZITADEL_CLIENT_SECRET, ZITADEL_CALLBACK_URL
    And the paste block was still printed

  @env-write @no-input
  Scenario: --application-env-file skips the write prompts
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --preset web --name "Acme" --redirect-uri http://localhost:3000/auth/callback --application-env-file .env.local --non-interactive`
    Then the CLI never asks "Write credentials to a .env file?"
    And the CLI prints "✔ Wrote issuer, client id, secret, and callback to .env.local"
    And under --json, data.wrote_env_file is ".env.local"

  @env-write @errors
  Scenario: Env write failure surfaces path and reason
    Given ZITADEL_PROJECT_ID is set
    And the path "/proc/invalid-unwritable.env" cannot be written
    When the developer runs create with `--application-env-file /proc/invalid-unwritable.env --non-interactive` and otherwise valid web flags
    Then the application may still have been created
    And the CLI prints "Could not write /proc/invalid-unwritable.env:" with the reason

  # ---------------------------------------------------------------------------
  # Partial flags — ask only missing
  # ---------------------------------------------------------------------------

  @interactive
  Scenario: Some flags supplied — only missing values asked
    Given ZITADEL_PROJECT_ID is set
    When the developer runs `zitadel application create --preset web` on a TTY
    Then the CLI does not ask "What are you connecting first?"
    And the CLI asks "What's your product called?"
    And after the name, the CLI asks for the sign-in callback

  # ---------------------------------------------------------------------------
  # Conflict
  # ---------------------------------------------------------------------------

  @conflict @errors @deferred-followup
  Scenario: Name derives a slug that already exists (registered — deferred to follow-up issue)
    Given ZITADEL_PROJECT_ID is set
    And a registered application with slug "acme-dashboard" and id "app_EXISTING" already exists
    When the developer runs `zitadel application create --preset web --name "Acme Dashboard" --redirect-uri http://localhost:3000/auth/callback --non-interactive`
    Then the command exits non-zero
    And the error is "An application with slug acme-dashboard already exists (app_EXISTING). Choose another product name, or pass a distinct name so the slug changes."
    And the existing application is not revised

  @conflict @interactive @deferred-followup
  Scenario: Interactive re-ask name after slug conflict (deferred to follow-up issue)
    Given ZITADEL_PROJECT_ID is set
    And a registered application with slug "acme-dashboard" already exists
    When the developer answers "Acme Dashboard" for the product name and continues with web
    Then the CLI refuses with the slug-exists message
    And the CLI asks "What's your product called?" again
    When the developer answers "Acme Dashboard 2"
    Then creation proceeds with a different derived slug

  @conflict @errors
  Scenario: Slug belongs to a declared application
    Given ZITADEL_PROJECT_ID is set
    And a declared application owns slug "acme-dashboard"
    When the developer runs create with `--name "Acme Dashboard" --preset web` and a valid redirect non-interactively
    Then the command exits non-zero
    And the error is "Slug acme-dashboard belongs to a declared application. Edit .zitadel/applications/acme-dashboard.json and deploy, or choose another name."

  # ---------------------------------------------------------------------------
  # Validation / flag errors
  # ---------------------------------------------------------------------------

  @errors @interactive
  Scenario: Empty product name rejected
    When the developer is asked "What's your product called?"
    And answers ""
    Then the CLI shows "Enter a product name"
    And the question is asked again

  @errors @interactive
  Scenario: Name that cannot yield a slug
    When the developer answers "!!!" for the product name
    Then the CLI shows "Could not derive an application slug from that name. Choose a name with letters or digits."

  @errors @interactive
  Scenario: Invalid sign-in callback URL (web)
    Given the developer chose Website with a backend
    When the developer chooses Custom… for the sign-in callback
    And enters "not-a-url"
    Then the CLI shows "Sign-in callback must be an https URL, or http on localhost / 127.0.0.1"
    Or shows "Enter a full URL, starting with the scheme, e.g. com.acme.tunes:/callback"

  @errors @interactive @native
  Scenario: Native callback without scheme
    Given the developer chose Mobile or desktop app
    When the developer chooses Custom…
    And enters "callback-only"
    Then the CLI shows "Enter a full URL, starting with the scheme, e.g. com.acme.tunes:/callback"

  @errors @interactive
  Scenario: Custom… then empty callback
    Given the developer is choosing a sign-in callback
    When the developer chooses Custom…
    And enters ""
    Then the CLI shows "Enter a sign-in callback URL"

  @errors @interactive
  Scenario: Duplicate redirect URI in the interactive list
    Given the developer already added "http://localhost:3000/auth/callback"
    When the developer answers Yes to "Add another redirect URI?"
    And enters "http://localhost:3000/auth/callback" again
    Then the CLI shows "That redirect URI is already listed"

  @errors @spa @interactive
  Scenario: Origin with a path rejected
    Given the developer chose Browser-only app
    When the developer enters allowed origin "http://localhost:5173/x"
    Then the CLI shows "An origin has no path. Use http://localhost:5173 instead of http://localhost:5173/x"

  @errors @spa @interactive
  Scenario: Empty origin rejected
    When the developer is asked "Allowed origin"
    And enters ""
    Then the CLI shows "Enter an allowed origin"

  @errors
  Scenario: --origin with --preset web
    When the developer runs `zitadel application create --preset web --name "Acme" --redirect-uri http://localhost:3000/auth/callback --origin http://localhost:3000 --non-interactive`
    Then the command exits non-zero
    And the error is "--origin only applies to browser-only apps (--preset spa). Remove it for --preset web; other presets don't call Zitadel from the browser"

  @errors
  Scenario: --origin with --preset native
    When the developer runs `zitadel application create --preset native --name "Acme" --redirect-uri http://127.0.0.1/callback --origin http://localhost --non-interactive`
    Then the command exits non-zero
    And the error is "--origin only applies to browser-only apps (--preset spa). Remove it for --preset native; other presets don't call Zitadel from the browser"

  @errors
  Scenario: Invalid --preset value
    When the developer runs `zitadel application create --preset help --name "Acme" --redirect-uri http://localhost:3000/auth/callback --non-interactive`
    Then the command exits non-zero
    And the error rejects preset "help"
    And the allowed values named are web, spa, native

  @errors
  Scenario: --post-logout-uri is not a flag in v1
    When the developer runs `zitadel application create --help`
    Then the help output does not list --post-logout-uri
    When the developer passes `--post-logout-uri http://localhost:3000` to create
    Then the CLI refuses unknown flag --post-logout-uri

  @errors
  Scenario: Comma-separated redirect URIs are not split
    When the developer runs create with a single `--redirect-uri http://localhost:3000/a,http://localhost:3000/b`
    Then the value is treated as one URI string
    And validation fails unless that literal string is a valid redirect URI

  # ---------------------------------------------------------------------------
  # API / sequencing failures
  # ---------------------------------------------------------------------------

  @errors @spa
  Scenario: spa preset before public clients exist on the server
    Given the server only accepts confidential clients
    When the developer runs `zitadel application create --preset spa --name "Acme" --redirect-uri http://localhost:5173/callback --origin http://localhost:5173 --non-interactive`
    Then the command exits non-zero
    And the error is "The server does not support public clients yet (--preset spa). Use --preset web, or wait for public client support."

  @errors @native
  Scenario: native preset before public clients exist on the server
    Given the server only accepts confidential clients
    When the developer runs `zitadel application create --preset native --name "Acme" --redirect-uri http://127.0.0.1/callback --non-interactive`
    Then the command exits non-zero
    And the error is "The server does not support public clients yet (--preset native). Use --preset web, or wait for public client support."

  @errors @native
  Scenario: Custom scheme rejected by today’s redirect rules
    Given the server accepts public clients but not custom-scheme redirect URIs
    When the developer runs `zitadel application create --preset native --name "Acme Tunes" --redirect-uri com.acme.tunes:/callback --non-interactive`
    Then the command exits non-zero
    And the error surfaces the server’s redirect URI validation (app.invalid) or a CLI pre-check equivalent

  @errors
  Scenario: API app.invalid for a bad redirect on web
    Given ZITADEL_PROJECT_ID is set
    When create would send a redirect URI the server rejects
    Then the command exits non-zero
    And the human error identifies the invalid setting without writing a success banner

  @errors
  Scenario: API authentication failure
    Given the project credential is invalid
    When the developer runs a otherwise-valid web create --non-interactive
    Then the command exits non-zero
    And no Application is created
    And the CLI does not print "✔ Created Application"

  @errors
  Scenario: API network / server unavailable
    Given the server is unreachable
    When the developer runs a otherwise-valid web create --non-interactive
    Then the command exits non-zero
    And the error describes the connection failure

  # ---------------------------------------------------------------------------
  # Discovery / help
  # ---------------------------------------------------------------------------

  @help
  Scenario: Command is discoverable via help (singular canonical + plural alias)
    When the developer runs `zitadel --help`
    Then application is listed under Sign-in
    When the developer runs `zitadel application --help`
    Then create is listed
    When the developer runs `zitadel application create --help`
    Then the flags include --name, --preset, --redirect-uri, --origin, --application-env-file, --non-interactive, --json
    And the flags do not include --post-logout-uri
    When the developer runs `zitadel applications create --help`
    Then the hidden plural alias answers identically to `zitadel application create --help`

  @interactive
  Scenario: Framework sniff preselects but still asks kind
    Given the project looks like a Next.js app
    When the developer runs `zitadel application create` on a TTY
    Then "Website with a backend" is the initial highlighted choice
    And the CLI still asks "What are you connecting first?"
