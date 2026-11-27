# language: en
# Manual-test Gherkin for OAuth runtime of public clients (#3409 / #3410).
# Sibling to applications-create.feature (CLI register) and applications-create-plan.md.
# Steps are human-executable: CLI create → discovery / authorize / token with curl.
# Not wired into automated CI; walk through on a local or preview server that has
# Slice 3+4 (or merged #3409 + #3410).
#
# Notation used below:
#   $ISSUER     = <ZITADEL_ISSUER>/__nextgen/oauth/<project_id>
#                 (same value the CLI prints as ZITADEL_ISSUER)
#   $CLIENT_ID  = the public client's id from create
#   $CODE_VERIFIER / $CODE_CHALLENGE = PKCE S256 pair
#
# Generate a PKCE pair once per scenario, e.g.:
#   CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=/+' | cut -c1-43)
#   CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -binary -sha256 | openssl base64 -A | tr '+/' '-_' | tr -d '=')

@oauth @public-clients @manual @issue-3294 @pr-3409 @pr-3410
Feature: OAuth runtime for SPA and native public clients

  Background:
    Given a reachable Zitadel server with public OAuth clients enabled (#3409)
    And the working directory is a project root with env cascade credentials
    And ZITADEL_ISSUER is set (used to build $ISSUER)

  # ---------------------------------------------------------------------------
  # Discovery
  # ---------------------------------------------------------------------------

  @discovery
  Scenario: Discovery advertises AuthMethodNone for public clients
    When the tester GETs "$ISSUER/.well-known/openid-configuration"
    # Alternate RFC 8414 path also works through the SDK proxy:
    #   GET {origin}/.well-known/oauth-authorization-server/__nextgen/oauth/<project_id>
    Then the response status is 200
    And the JSON field "issuer" equals $ISSUER
    And the JSON field "authorization_endpoint" ends with "/authorize"
    And the JSON field "token_endpoint" ends with "/token"
    And the JSON array "token_endpoint_auth_methods_supported" includes "none"
    And the JSON array "token_endpoint_auth_methods_supported" includes "client_secret_basic"
    And the JSON array "code_challenge_methods_supported" includes "S256"
    # CORS today is server-wide "*", not filtered by allowed_origins (#3409 caveat):
    And a browser Origin header of "https://evil.example" still receives Access-Control-Allow-Origin "*"

  # ---------------------------------------------------------------------------
  # SPA happy path — register, authorize with PKCE, token with client_id only
  # ---------------------------------------------------------------------------

  @spa @happy
  Scenario: SPA public client — authorize with PKCE, token without secret
    Given the tester creates a SPA client:
      """
      zitadel application create \
        --name "Acme Boards" \
        --preset spa \
        --redirect-uri http://localhost:5173/callback \
        --origin http://localhost:5173 \
        --non-interactive --json
      """
    Then the JSON data.client.type is "public"
    And data.client.secret is absent
    And data.env.ZITADEL_CLIENT_SECRET is absent
    And data.env.ZITADEL_ALLOWED_ORIGINS is "http://localhost:5173"
    And the tester records $ISSUER, $CLIENT_ID, and redirect_uri from the envelope

    Given a fresh PKCE S256 pair ($CODE_VERIFIER, $CODE_CHALLENGE)
    When the tester opens in a browser (or curl -i -L with Accept: text/html):
      """
      GET $ISSUER/authorize?\
        client_id=$CLIENT_ID&\
        redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fcallback&\
        response_type=code&\
        scope=openid&\
        state=spa-manual-1&\
        code_challenge=$CODE_CHALLENGE&\
        code_challenge_method=S256
      """
    Then the server does not return error=invalid_request for missing PKCE
    And the flow reaches the login UI (or a login redirect), not an OAuth error page
    # After signing in (or completing whatever the preview login allows):
    When the authorization completes and the browser lands on
      "http://localhost:5173/callback?code=…&state=spa-manual-1"
    Then the query has a non-empty "code"
    And the query "state" is "spa-manual-1"

    When the tester exchanges the code without a client secret:
      """
      curl -sS -X POST "$ISSUER/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=authorization_code" \
        -d "client_id=$CLIENT_ID" \
        -d "code=$CODE" \
        -d "redirect_uri=http://localhost:5173/callback" \
        -d "code_verifier=$CODE_VERIFIER"
      """
    Then the response status is 200
    And the JSON includes "access_token"
    And the JSON includes "token_type" of "Bearer"
    And the response does not require client_secret_basic or a secret form field

  # ---------------------------------------------------------------------------
  # Native happy paths — custom scheme + loopback
  # ---------------------------------------------------------------------------

  @native @happy @custom-scheme
  Scenario: Native public client — private-use redirect scheme is accepted at authorize
    Given the tester creates a native client:
      """
      zitadel application create \
        --name "Acme Tunes" \
        --preset native \
        --redirect-uri com.acme.tunes:/callback \
        --non-interactive --json
      """
    Then the JSON data.client.type is "public"
    And data.env omits ZITADEL_ALLOWED_ORIGINS
    And the tester records $ISSUER and $CLIENT_ID

    Given a fresh PKCE S256 pair
    When the tester GETs:
      """
      $ISSUER/authorize?\
        client_id=$CLIENT_ID&\
        redirect_uri=com.acme.tunes%3A%2Fcallback&\
        response_type=code&\
        scope=openid&\
        state=native-scheme-1&\
        code_challenge=$CODE_CHALLENGE&\
        code_challenge_method=S256
      """
    Then the server accepts the redirect_uri (no invalid_request for scheme)
    And the flow reaches login rather than rejecting the private-use URI
    # Completing login redirects to com.acme.tunes:/callback?code=…&state=…
    # (observe Location header or OS handler prompt). Token exchange uses the
    # same redirect_uri and code_verifier as SPA, still without a secret.

  @native @happy @loopback
  Scenario: Native public client — loopback http redirect with any port
    Given a native client registered with redirect_uri "http://127.0.0.1/callback"
      # create with --redirect-uri http://127.0.0.1/callback, or add that URI
      # if the create preset used a custom scheme only
    And a fresh PKCE S256 pair
    When the tester authorizes with
      redirect_uri=http://127.0.0.1:54321/callback
      (same path, ephemeral loopback port — RFC 8252 §7.3 / native policy)
    Then the server accepts the loopback redirect (public → ApplicationTypeNative)
    And after login the Location targets http://127.0.0.1:54321/callback?code=…

  # ---------------------------------------------------------------------------
  # Failure cases
  # ---------------------------------------------------------------------------

  @spa @errors @pkce
  Scenario: Public client authorize without PKCE is refused
    Given a SPA $CLIENT_ID from a prior create
    When the tester GETs "$ISSUER/authorize" with client_id, redirect_uri,
      response_type=code, scope=openid, state=no-pkce
      and omits code_challenge and code_challenge_method
    Then the response is an OAuth error
    And the error is "invalid_request"
    And the description mentions that code_challenge is required for a public client

  @spa @errors @token
  Scenario: Public client token with wrong code_verifier fails
    Given a SPA authorization that completed with PKCE and yielded $CODE
    When the tester POSTs to "$ISSUER/token" with grant_type=authorization_code,
      client_id=$CLIENT_ID, code=$CODE, redirect_uri matching authorize,
      and code_verifier="definitely-not-the-verifier"
    Then the response is not 200
    And the error indicates an invalid grant / PKCE mismatch

  @web @errors @secret
  Scenario: Confidential client cannot use AuthMethodNone on token
    Given a web (confidential) client from:
      """
      zitadel application create \
        --name "Acme Dashboard" \
        --preset web \
        --redirect-uri http://localhost:3000/auth/callback \
        --non-interactive --json
      """
    And the tester recorded $CLIENT_ID and $CLIENT_SECRET
    And an authorization code obtained for that client (PKCE optional for confidential)
    When the tester POSTs to "$ISSUER/token" with grant_type=authorization_code,
      client_id=$CLIENT_ID, code=$CODE, redirect_uri=…,
      and omits client_secret
    Then the response status is 401
    And the error is "invalid_client"
    And the description says the client must authenticate with its client secret
    When the tester retries the same token request with client_secret=$CLIENT_SECRET
      (or client_secret_basic)
    Then the response status is 200 and includes access_token

  @errors @redirect
  Scenario: Authorize with an unregistered redirect_uri is refused
    Given a SPA $CLIENT_ID whose only redirect_uri is http://localhost:5173/callback
    When the tester GETs authorize with redirect_uri=https://attacker.example/cb
      and a valid PKCE challenge
    Then the response is an OAuth error for the redirect_uri
    And no login page is shown for the attacker URI

  @native @errors @redirect
  Scenario: Confidential client cannot use a private-use redirect
    # Domain rule from #3409: private-use schemes are for public clients only.
    When the tester attempts to publish a confidential client whose redirect_uris
      include "com.acme.app:/callback" (API POST /applications or CLI if forced)
    Then the server refuses the document
    And the validation names the redirect URI / private-use rule

  @spa @errors @origin
  Scenario: allowed_origins are stored and validated; CORS is not filtered yet
    Given a SPA create with --origin http://localhost:5173
    Then GET /applications/{id} shows allowed_origins: ["http://localhost:5173"]
    When the tester tries to create with --origin "http://localhost:5173/path"
    Then the CLI refuses (origin must be scheme://host[:port] with no path)
    When the tester tries --origin with --preset web
    Then the CLI refuses ("--origin only applies to browser-only apps")
    # Runtime note (observe, do not expect a block):
    And OAuth CORS remains Access-Control-Allow-Origin "*" for any Origin
    And per-client allowed_origins are not used to filter CORS in #3409

  # ---------------------------------------------------------------------------
  # End-to-end checklist (short walkthrough)
  # ---------------------------------------------------------------------------

  @checklist
  Scenario Outline: Manual walkthrough checklist per preset
    Given the #3409+#3410 stack (or merged main with those changes)
    When the tester runs the <preset> create and OAuth steps above
    Then discovery includes "none"
    And authorize for that public client requires PKCE
    And token succeeds with client_id only plus code_verifier
    And the failure cases for that preset still hold

    Examples:
      | preset |
      | spa    |
      | native |
