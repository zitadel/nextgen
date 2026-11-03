package domain

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/httputil"
)

// PrefixApp namespaces app ids ("app_01KWH3B..."), shared by every revision.
const PrefixApp ResourcePrefix = "app"

// PrefixAppRevision namespaces app revision ids ("apprev_01KWH3B..."), what a
// release pins.
const PrefixAppRevision ResourcePrefix = "apprev"

// PrefixAppClient namespaces the row that holds a client's id. A client_id
// the server mints is that row's id ("client_01KWH3B..."); a client_id the
// document chose sits beside it, so no caller ever picks a primary key
// (ADR 047 §4).
const PrefixAppClient ResourcePrefix = "client"

// PrefixAppClientSecret namespaces stored client secret hashes
// ("csec_01KWH3B..."), storage-only rows under a client.
const PrefixAppClientSecret ResourcePrefix = "csec"

// AppSource says who writes an app, and so where the authorization server
// reads it from. Every app has one writer.
type AppSource string

const (
	// AppSourceDeclared is an app in the release, written by a release build
	// and read at the revision a deployment pins.
	AppSourceDeclared AppSource = "declared"
	// AppSourceRegistered is an app written through POST /apps, read at its
	// newest revision.
	AppSourceRegistered AppSource = "registered"
	// AppSourceBuiltin is an app the server itself declares, such as the
	// platform project's `zitadel`: read-only and versioned with the binary.
	AppSourceBuiltin AppSource = "builtin"
)

func ErrAppNotFound() Error {
	return newError(PrefixApp.ErrorCodePrefix("not_found"), "app: not found", nil, nil)
}

// ErrAppInvalid refuses a document the meta-schema accepts but the rules
// across its fields do not: a reference to an API the app does not serve, a
// redirect URI a browser may not be sent to, two configs with one slug.
// details lists each violation with the path of the field.
func ErrAppInvalid(details any) Error {
	return newError(PrefixApp.ErrorCodePrefix("invalid"), "app: invalid", details, nil)
}

// ErrAppFieldImmutable refuses a revision that changes what a client is known
// by: its client_id. details names the field.
func ErrAppFieldImmutable(details any) Error {
	return newError(PrefixApp.ErrorCodePrefix("field_immutable"), "app: the field is fixed for the life of the client", details, nil)
}

// ErrAppDeclared refuses a write through the API to an app the release
// declares: a declared app changes only with the release, so it has one
// writer.
func ErrAppDeclared() Error {
	return newError(PrefixApp.ErrorCodePrefix("declared"), "app: declared in the release, so only a release changes it", nil, nil)
}

// ErrAppClientIDTaken refuses a client_id another client in the project holds
// or held: a client_id names one client for the life of the project.
func ErrAppClientIDTaken(details any) Error {
	return newError(PrefixApp.ErrorCodePrefix("client_id_taken"), "app: another client in the project holds the client_id", details, nil)
}

// ErrAppIdentifierTaken refuses an API identifier another app in the project
// serves or served: an identifier is one audience, so it stays with its app.
func ErrAppIdentifierTaken(details any) Error {
	return newError(PrefixApp.ErrorCodePrefix("identifier_taken"), "app: another app in the project holds the API identifier", details, nil)
}

// ErrAppPermissionDenied answers a caller whose project grant does not reach
// the operation, such as a viewer writing an app.
func ErrAppPermissionDenied() Error {
	return newError(PrefixApp.ErrorCodePrefix("permission_denied"), "app: the caller's project role does not allow this operation", nil, nil)
}

// ErrAppRevisionConflict reports a revision that landed on the same instant as
// another revision of the same app, so neither is newest.
func ErrAppRevisionConflict() Error {
	return newError(PrefixApp.ErrorCodePrefix("revision_conflict"), "app: another revision of the same app was created at the same instant", nil, nil)
}

// ErrAppClientNotFound reports a client_id no app client holds, or one whose
// app does not serve the request: a declared app the deployment does not pin,
// or a client the pinned revision no longer has.
func ErrAppClientNotFound() Error {
	return newError(PrefixApp.ErrorCodePrefix("client_not_found"), "app: no client has the client_id", nil, nil)
}

// ErrAppAPINotFound reports a resource no app API serves.
func ErrAppAPINotFound() Error {
	return newError(PrefixApp.ErrorCodePrefix("api_not_found"), "app: no API has the identifier", nil, nil)
}

// ErrAppClientSecretInvalid reports a client secret that matches none the
// client holds. The authorization server answers invalid_client.
func ErrAppClientSecretInvalid() Error {
	return newError(PrefixApp.ErrorCodePrefix("client_secret_invalid"), "app: the client secret does not match", nil, nil)
}

// ErrInvalidScope reports a requested scope the API does not define, or one
// the client may not get. The authorization server answers invalid_scope:
// a scope is refused, never dropped silently. details names the scopes.
func ErrInvalidScope(details any) Error {
	return newError(PrefixApp.ErrorCodePrefix("invalid_scope"), "app: a requested scope is unknown or not allowed for the client", details, nil)
}

// App is one app at one revision, as storage holds it. The app row holds
// identity, every write appends a revision holding the document, and a
// release pins a revision. The document is raw JSON, stored as authored:
// client ids the server minted live in their own rows (AppClientID).
type App struct {
	ProjectID  string
	ID         string
	Slug       string
	Source     AppSource
	RevisionID string
	Document   []byte
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// AppField enumerates the fields of App that list operations filter and
// order by.
type AppField uint8

const (
	AppFieldUnspecified AppField = iota
	AppFieldProjectID
	AppFieldID
	AppFieldSlug
	AppFieldSource
	AppFieldRevisionID
	AppFieldCreatedAt
	AppFieldUpdatedAt
	AppFieldDocument
)

// AppClientID is the row that ties a client of an app to its client_id. It
// outlives the revisions that list the client, so an id is never reissued to
// another client, and a client removed and added back gets its id again.
type AppClientID struct {
	ProjectID string
	// ID is the row's minted id. When the document sets no client_id, it is
	// also the client_id.
	ID        string
	AppID     string
	Slug      string
	ClientID  string
	CreatedAt time.Time
}

// AppAPIIdentifier ties an API identifier to the app that serves it, for
// good: once an app used an identifier, no other app in the project may.
type AppAPIIdentifier struct {
	ProjectID  string
	Identifier string
	AppID      string
	CreatedAt  time.Time
}

// AppClientSecret is one stored secret of a registered app's client: a hash,
// never the value.
type AppClientSecret struct {
	ProjectID   string
	ID          string
	ClientRowID string
	// EncodedHash is "sha256:<hex>" for a secret the server generated or an
	// imported plaintext, or a passwap encoding for an imported hash, which
	// is moved to sha256 on its first successful use.
	EncodedHash string
	CreatedAt   time.Time
}

// ClientType is an OAuth client type (RFC 6749 §2.1).
type ClientType string

const (
	ClientTypePublic       ClientType = "public"
	ClientTypeConfidential ClientType = "confidential"
)

// ClientAuthMethod is how a client authenticates at the token endpoint.
type ClientAuthMethod string

const (
	ClientAuthNone              ClientAuthMethod = "none"
	ClientAuthClientSecretBasic ClientAuthMethod = "client_secret_basic"
	ClientAuthClientSecretPost  ClientAuthMethod = "client_secret_post"
	ClientAuthPrivateKeyJWT     ClientAuthMethod = "private_key_jwt"
)

// UsesSecret reports whether the method authenticates with a client secret.
func (m ClientAuthMethod) UsesSecret() bool {
	return m == ClientAuthClientSecretBasic || m == ClientAuthClientSecretPost
}

// ConsentPolicy is when the user is asked to consent to a client.
type ConsentPolicy string

const (
	// ConsentSkip asks only when the request says prompt=consent. Only a
	// first-party client may skip.
	ConsentSkip ConsentPolicy = "skip"
	// ConsentNewScopes asks for scopes the user has not consented to yet.
	ConsentNewScopes ConsentPolicy = "new_scopes"
	// ConsentAlways asks on every request.
	ConsentAlways ConsentPolicy = "always"
)

// GrantType is an OAuth grant type a client may use.
type GrantType string

const (
	GrantAuthorizationCode GrantType = "authorization_code"
	GrantRefreshToken      GrantType = "refresh_token"
	GrantClientCredentials GrantType = "client_credentials"
)

// BuiltinScopes are the OpenID Connect scopes every API accepts. An API
// cannot define them again.
var BuiltinScopes = []string{"openid", "profile", "email", "address", "phone", "offline_access"}

// AppDocument is the app document: the body of POST /apps and the content of
// `.zitadel/apps/<slug>.json`. The meta-schema (app.json) checks each field;
// Validate checks the rules across fields.
type AppDocument struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	// The display fields a client ID metadata document carries (RFC 7591),
	// so the consent and account-choice steps read both alike.
	LogoURI      string          `json:"logo_uri,omitempty"`
	ClientURI    string          `json:"client_uri,omitempty"`
	PolicyURI    string          `json:"policy_uri,omitempty"`
	TOSURI       string          `json:"tos_uri,omitempty"`
	Preset       string          `json:"preset,omitempty"`
	Clients      []AppClient     `json:"clients,omitempty"`
	APIs         []AppAPI        `json:"apis,omitempty"`
	Registration AppRegistration `json:"registration,omitzero"`
}

// AppClient is an OAuth client of an app.
type AppClient struct {
	Slug       string           `json:"slug"`
	Name       string           `json:"name,omitempty"`
	ClientID   string           `json:"client_id,omitempty"`
	Type       ClientType       `json:"type"`
	AuthMethod ClientAuthMethod `json:"auth_method,omitempty"`
	Secret     string           `json:"secret,omitempty"`
	// JWKS is the public key set a private_key_jwt client signs its
	// assertions with, passed to the authorization server as written.
	JWKS                   json.RawMessage `json:"jwks,omitempty"`
	Grants                 []GrantType     `json:"grants"`
	RedirectURIs           []string        `json:"redirect_uris,omitempty"`
	PostLogoutRedirectURIs []string        `json:"post_logout_redirect_uris,omitempty"`
	FirstParty             *bool           `json:"first_party,omitempty"`
	Consent                ConsentPolicy   `json:"consent,omitempty"`
	AccountChoice          bool            `json:"account_choice,omitempty"`
	// IDTokenSignedResponseAlg is RS256 when empty (ADR 082 §7).
	IDTokenSignedResponseAlg string      `json:"id_token_signed_response_alg,omitempty"`
	APIs                     []ClientAPI `json:"apis,omitempty"`
}

// ClientAPI is one API a client may get tokens for. API is a slug of the
// client's own app or `<app>/<api>`; Scopes nil means every scope the API
// defines.
type ClientAPI struct {
	API    string   `json:"api"`
	Scopes []string `json:"scopes,omitempty"`
}

// AppAPI is an API an app serves. Identifier is the `aud` of its tokens.
type AppAPI struct {
	Slug       string     `json:"slug"`
	Name       string     `json:"name,omitempty"`
	Identifier string     `json:"identifier"`
	Scopes     []APIScope `json:"scopes,omitempty"`
	// SigningAlg is RS256 when empty (ADR 082 §7).
	SigningAlg string `json:"signing_alg,omitempty"`
	ThirdParty bool   `json:"third_party,omitempty"`
}

// APIScope is a scope an API defines, with its consent line.
type APIScope struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// AppRegistration says how clients may register into an app.
type AppRegistration struct {
	ClientIDMetadataDocuments bool `json:"client_id_metadata_documents,omitempty"`
	Dynamic                   bool `json:"dynamic,omitempty"`
}

// Open reports whether clients may register into the app either way.
func (r AppRegistration) Open() bool {
	return r.ClientIDMetadataDocuments || r.Dynamic
}

// ParseAppDocument reads an app document. It checks no rule: the meta-schema
// runs before it and Validate after.
func ParseAppDocument(document []byte) (AppDocument, error) {
	var doc AppDocument
	err := json.Unmarshal(document, &doc)
	return doc, err
}

// AppViolation is one rule a document breaks, with the path of the field in
// the document's JSON.
type AppViolation struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// Validate checks the rules across the document's fields that the
// meta-schema cannot say, for an app source writes. It returns
// ErrAppInvalid listing every violation, or nil.
func (d AppDocument) Validate(source AppSource) error {
	var v []AppViolation
	add := func(path, format string, args ...any) {
		v = append(v, AppViolation{Path: path, Message: fmt.Sprintf(format, args...)})
	}

	// A slug names one config of the app, so `<app>/<slug>` names one thing.
	seen := map[string]string{}
	for i, c := range d.Clients {
		path := fmt.Sprintf("/clients/%d/slug", i)
		if other, ok := seen[c.Slug]; ok {
			add(path, "slug %q is also %s", c.Slug, other)
			continue
		}
		seen[c.Slug] = path
	}
	for i, api := range d.APIs {
		path := fmt.Sprintf("/apis/%d/slug", i)
		if other, ok := seen[api.Slug]; ok {
			add(path, "slug %q is also %s", api.Slug, other)
			continue
		}
		seen[api.Slug] = path
	}

	identifiers := map[string]int{}
	for i, api := range d.APIs {
		base := fmt.Sprintf("/apis/%d", i)
		if err := checkAPIIdentifier(api.Identifier); err != nil {
			add(base+"/identifier", "%s", err)
		}
		if j, ok := identifiers[api.Identifier]; ok {
			add(base+"/identifier", "identifier is also the one of /apis/%d", j)
		} else {
			identifiers[api.Identifier] = i
		}
		names := map[string]bool{}
		for j, scope := range api.Scopes {
			path := fmt.Sprintf("%s/scopes/%d/name", base, j)
			if slices.Contains(BuiltinScopes, scope.Name) {
				add(path, "%q is a built-in scope", scope.Name)
			}
			if names[scope.Name] {
				add(path, "scope %q is defined twice", scope.Name)
			}
			names[scope.Name] = true
		}
	}

	for i, c := range d.Clients {
		base := fmt.Sprintf("/clients/%d", i)
		if PrefixAppClient.Matches(c.ClientID) || PrefixClientRegistration.Matches(c.ClientID) {
			add(base+"/client_id", "a chosen client_id may not take a form the server mints (%s_... or %s_...)", PrefixAppClient, PrefixClientRegistration)
		}
		switch c.Type {
		case ClientTypePublic:
			// A public client proves itself with PKCE alone: it holds nothing a
			// token endpoint could check, so it cannot act as itself.
			if c.AuthMethod != "" && c.AuthMethod != ClientAuthNone {
				add(base+"/auth_method", "a public client authenticates with none")
			}
			if c.Secret != "" {
				add(base+"/secret", "a public client holds no secret")
			}
			if slices.Contains(c.Grants, GrantClientCredentials) {
				add(base+"/grants", "a public client may not use client_credentials")
			}
		case ClientTypeConfidential:
			if c.AuthMethod == ClientAuthNone {
				add(base+"/auth_method", "a confidential client authenticates with a secret or a key")
			}
		}
		if c.EffectiveAuthMethod() == ClientAuthPrivateKeyJWT {
			if err := checkJWKS(c.JWKS); err != nil {
				add(base+"/jwks", "%s", err)
			}
			if c.Secret != "" {
				add(base+"/secret", "a private_key_jwt client authenticates with its keys, not a secret")
			}
		} else if len(c.JWKS) > 0 {
			add(base+"/jwks", "jwks is for a private_key_jwt client")
		}
		if c.Consent == ConsentSkip && !c.IsFirstParty(source) {
			add(base+"/consent", "only a first-party client may skip consent")
		}
		if slices.Contains(c.Grants, GrantRefreshToken) && !slices.Contains(c.Grants, GrantAuthorizationCode) {
			add(base+"/grants", "refresh_token needs authorization_code: OAuth 2.1 issues no refresh token for client_credentials")
		}
		if slices.Contains(c.Grants, GrantAuthorizationCode) && len(c.RedirectURIs) == 0 {
			add(base+"/redirect_uris", "authorization_code needs at least one redirect URI")
		}
		for j, uri := range c.RedirectURIs {
			if err := checkRedirectURI(uri, c.Type); err != nil {
				add(fmt.Sprintf("%s/redirect_uris/%d", base, j), "%s", err)
			}
		}
		for j, uri := range c.PostLogoutRedirectURIs {
			if err := checkRedirectURI(uri, c.Type); err != nil {
				add(fmt.Sprintf("%s/post_logout_redirect_uris/%d", base, j), "%s", err)
			}
		}
		if c.EffectiveAuthMethod().UsesSecret() {
			switch {
			case source == AppSourceRegistered && c.Secret != "":
				add(base+"/secret", "an app registered through the API gets its secrets from the server or an import, not a variable reference")
			case source == AppSourceDeclared && c.Secret == "":
				add(base+"/secret", "a confidential client declared in the release needs its secret as a ${{ NAME }} reference")
			}
		}
		refs := map[string]bool{}
		for j, ref := range c.APIs {
			path := fmt.Sprintf("%s/apis/%d", base, j)
			if refs[ref.API] {
				add(path+"/api", "API %q is listed twice", ref.API)
			}
			refs[ref.API] = true
			appSlug, apiSlug := splitAPIRef(ref.API)
			if appSlug != "" && appSlug != d.Slug {
				// Another app's API is resolved when a request names it: the
				// app may be written later, and nothing waits for it.
				continue
			}
			api, ok := d.api(apiSlug)
			if !ok {
				add(path+"/api", "the app serves no API %q", apiSlug)
				continue
			}
			for k, scope := range ref.Scopes {
				if !api.definesScope(scope) {
					add(fmt.Sprintf("%s/scopes/%d", path, k), "API %q defines no scope %q", apiSlug, scope)
				}
			}
		}
	}

	if d.Registration.Open() && !slices.ContainsFunc(d.APIs, func(api AppAPI) bool { return api.ThirdParty }) {
		add("/registration", "registered clients may ask only for third_party APIs, and the app has none")
	}

	if len(v) > 0 {
		return ErrAppInvalid(map[string]any{"violations": v})
	}
	return nil
}

// Client returns the client with slug.
func (d AppDocument) Client(slug string) (AppClient, bool) {
	i := slices.IndexFunc(d.Clients, func(c AppClient) bool { return c.Slug == slug })
	if i < 0 {
		return AppClient{}, false
	}
	return d.Clients[i], true
}

func (d AppDocument) api(slug string) (AppAPI, bool) {
	i := slices.IndexFunc(d.APIs, func(api AppAPI) bool { return api.Slug == slug })
	if i < 0 {
		return AppAPI{}, false
	}
	return d.APIs[i], true
}

// APIByIdentifier returns the API whose identifier is identifier.
func (d AppDocument) APIByIdentifier(identifier string) (AppAPI, bool) {
	i := slices.IndexFunc(d.APIs, func(api AppAPI) bool { return api.Identifier == identifier })
	if i < 0 {
		return AppAPI{}, false
	}
	return d.APIs[i], true
}

// Identifiers returns the identifiers of the APIs the app serves.
func (d AppDocument) Identifiers() []string {
	identifiers := make([]string, len(d.APIs))
	for i, api := range d.APIs {
		identifiers[i] = api.Identifier
	}
	return identifiers
}

func (api AppAPI) definesScope(name string) bool {
	return slices.ContainsFunc(api.Scopes, func(s APIScope) bool { return s.Name == name })
}

// ScopeNames returns the scopes the API defines, without the built-in ones.
func (api AppAPI) ScopeNames() []string {
	names := make([]string, len(api.Scopes))
	for i, s := range api.Scopes {
		names[i] = s.Name
	}
	return names
}

// splitAPIRef splits `<app>/<api>` into its parts; a bare slug has no app.
func splitAPIRef(ref string) (appSlug, apiSlug string) {
	if before, after, ok := strings.Cut(ref, "/"); ok {
		return before, after
	}
	return "", ref
}

// EffectiveAuthMethod is the client's auth_method, or its type's default.
func (c AppClient) EffectiveAuthMethod() ClientAuthMethod {
	if c.AuthMethod != "" {
		return c.AuthMethod
	}
	if c.Type == ClientTypePublic {
		return ClientAuthNone
	}
	return ClientAuthClientSecretBasic
}

// EffectiveConsent is the client's consent policy, or else skip for a
// first-party client and new_scopes for a third-party one.
func (c AppClient) EffectiveConsent(source AppSource) ConsentPolicy {
	if c.Consent != "" {
		return c.Consent
	}
	if c.IsFirstParty(source) {
		return ConsentSkip
	}
	return ConsentNewScopes
}

// IsFirstParty reports whether the client skips consent: its first_party
// field, or else true for a declared or built-in app and false for a
// registered one (ADR 082 §3).
func (c AppClient) IsFirstParty(source AppSource) bool {
	if c.FirstParty != nil {
		return *c.FirstParty
	}
	return source != AppSourceRegistered
}

// HasGrant reports whether the client may use grant.
func (c AppClient) HasGrant(grant GrantType) bool {
	return slices.Contains(c.Grants, grant)
}

// ResolvedApp is an app as the authorization server reads it: the revision
// that serves a request, parsed, with each client's client_id filled in.
type ResolvedApp struct {
	ProjectID  string
	ID         string
	Slug       string
	Source     AppSource
	RevisionID string
	Document   AppDocument
}

// ClientAPIAccess is what a client may get for one API.
type ClientAPIAccess struct {
	// Allowed reports whether the client may get tokens for the API at all.
	Allowed bool
	// Scopes are the API's own scopes the client may get; the built-in ones
	// are always open.
	Scopes []string
}

// AccessTo says what client, a client of app, may get for api, an API of
// apiApp. A client of the app lists the API by slug, or by `<app>/<api>`
// when another app serves it. A client of no app (one that registered
// itself) may get a third_party API and any of its scopes, each with the
// user's consent; the caller passes a zero AppClient for it.
func (app *ResolvedApp) AccessTo(client AppClient, apiApp *ResolvedApp, api AppAPI) ClientAPIAccess {
	if client.Slug == "" {
		if !api.ThirdParty {
			return ClientAPIAccess{}
		}
		return ClientAPIAccess{Allowed: true, Scopes: api.ScopeNames()}
	}
	for _, ref := range client.APIs {
		appSlug, apiSlug := splitAPIRef(ref.API)
		if appSlug == "" {
			appSlug = app.Slug
		}
		if appSlug != apiApp.Slug || apiSlug != api.Slug {
			continue
		}
		if ref.Scopes == nil {
			return ClientAPIAccess{Allowed: true, Scopes: api.ScopeNames()}
		}
		return ClientAPIAccess{Allowed: true, Scopes: slices.Clone(ref.Scopes)}
	}
	return ClientAPIAccess{}
}

// GrantScopes checks requested against what access allows for api and
// returns them in request order without duplicates. Every requested scope
// must be built in or one the API defines and the client may get; anything
// else is ErrInvalidScope naming the scopes, never dropped. Consent may then
// narrow what is granted.
func GrantScopes(api AppAPI, access ClientAPIAccess, requested []string) ([]string, error) {
	var granted, unknown, denied []string
	for _, scope := range requested {
		if slices.Contains(granted, scope) {
			continue
		}
		switch {
		case slices.Contains(BuiltinScopes, scope):
		case !api.definesScope(scope):
			unknown = append(unknown, scope)
			continue
		case !slices.Contains(access.Scopes, scope):
			denied = append(denied, scope)
			continue
		}
		granted = append(granted, scope)
	}
	if len(unknown) > 0 || len(denied) > 0 {
		details := map[string][]string{}
		if len(unknown) > 0 {
			details["unknown"] = unknown
		}
		if len(denied) > 0 {
			details["not_allowed"] = denied
		}
		return nil, ErrInvalidScope(details)
	}
	return granted, nil
}

// checkJWKS accepts a key set with at least one key, each with its own kid
// when there are several, so an assertion's kid picks one. The meta-schema
// already admits public members only.
func checkJWKS(raw json.RawMessage) error {
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
		} `json:"keys"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &set) != nil || len(set.Keys) == 0 {
		return fmt.Errorf("a private_key_jwt client needs its public keys in jwks")
	}
	if len(set.Keys) == 1 {
		return nil
	}
	seen := map[string]bool{}
	for _, key := range set.Keys {
		if key.Kid == "" || seen[key.Kid] {
			return fmt.Errorf("several keys need a kid each, and no two alike")
		}
		seen[key.Kid] = true
	}
	return nil
}

// checkAPIIdentifier accepts an https URL, an http URL on a loopback host, or
// a urn, none with a fragment or userinfo (RFC 8707 §2).
func checkAPIIdentifier(identifier string) error {
	if strings.HasPrefix(identifier, "urn:") {
		if strings.ContainsAny(identifier, "# \t\r\n") || strings.Count(identifier, ":") < 2 {
			return fmt.Errorf("a urn identifier is urn:<namespace>:<name>, without a fragment")
		}
		return nil
	}
	u, err := url.Parse(identifier)
	if err != nil || !u.IsAbs() || u.Host == "" || u.Opaque != "" {
		return fmt.Errorf("the identifier is not an absolute URL")
	}
	if strings.Contains(identifier, "#") {
		return fmt.Errorf("the identifier has a fragment")
	}
	if u.User != nil {
		return fmt.Errorf("the identifier carries userinfo")
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		if isLoopbackHost(u.Hostname()) {
			return nil
		}
		return fmt.Errorf("an http identifier must be on a loopback host")
	default:
		return fmt.Errorf("the identifier must be https, loopback http or a urn")
	}
}

// privateUseScheme is a native app's reverse-domain redirect scheme, such as
// com.example.app (RFC 8252 §7.1): it has a dot, so it names a domain the app's
// developer controls.
var privateUseScheme = regexp.MustCompile(`^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+$`)

// checkRedirectURI accepts a URI the authorization server may send a browser
// to: https, http on a loopback host, or for a public client a private-use
// scheme. It must be its own canonical form, so the browser goes byte for
// byte to the URI that was checked, and carry no fragment.
func checkRedirectURI(uri string, clientType ClientType) error {
	if strings.Contains(uri, "#") {
		return fmt.Errorf("a redirect URI may not have a fragment")
	}
	scheme, rest, ok := strings.Cut(uri, ":")
	if ok && privateUseScheme.MatchString(scheme) {
		if clientType != ClientTypePublic {
			return fmt.Errorf("only a public client may use a private-use scheme")
		}
		if !strings.HasPrefix(rest, "/") || strings.HasPrefix(rest, "//") {
			return fmt.Errorf("a private-use redirect URI is <scheme>:/<path>")
		}
		return nil
	}
	u, err := httputil.ParseRedirectTarget(uri)
	if err != nil {
		return err
	}
	if u.String() != uri {
		return fmt.Errorf("the redirect URI is not in its canonical form %q", u.String())
	}
	if u.Scheme == "http" && !isLoopbackHost(u.Hostname()) {
		return fmt.Errorf("an http redirect URI must be on a loopback host")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
