// Package idp is the identity-provider engine: it turns a pinned connection
// revision into a relying-party client and drives the sign-in ceremony with
// it. It reads no storage and serves no routes; callers hand it the revision
// and the hardened egress client.
package idp

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"golang.org/x/oauth2"

	"github.com/zitadel/nextgen/internal/domain"
)

// SigningAlgorithms is the fixed allowlist for id_token signatures:
// asymmetric only. none is unsigned and the HMAC family signs with the
// shared client secret, so anyone holding the secret could forge a token.
// A discovery document never widens this set: the engine
// does not read its id_token_signing_alg_values_supported and must not use
// the library option that does. The callback builds its verifier with this
// list.
func SigningAlgorithms() []string {
	return []string{"RS256", "ES256", "PS256"}
}

// OIDCConnection is the engine's view of the OIDC block of a connection
// revision. The endpoint fields are all set or all empty:
//   - set: no discovery call needed.
//   - empty: fetch the endpoints from the discovery document.
type OIDCConnection struct {
	Issuer   string
	ClientID string
	// ClientSecretRef is the unresolved `${{ NAME }}` reference. The
	// `authorize` step needs no secret; the `callback` resolves it per attempt.
	ClientSecretRef         string
	TokenEndpointAuthMethod TokenEndpointAuthMethod
	Scopes                  []string
	PKCEEnabled             bool
	// StaticAuthorizeParameters are appended to the `authorize` request after
	// the engine-owned keys are dropped.
	StaticAuthorizeParameters map[string]string

	AuthorizationEndpoint string
	TokenEndpoint         string
	UserinfoEndpoint      string
	JWKSURI               string
	// IDTokenMapping reads claims from the id_token, so the connection has
	// no use for a `userinfo` endpoint.
	IDTokenMapping bool
}

// TokenEndpointAuthMethod is how the client authenticates at the token
// endpoint.
type TokenEndpointAuthMethod string

const (
	ClientSecretBasic TokenEndpointAuthMethod = "client_secret_basic"
	ClientSecretPost  TokenEndpointAuthMethod = "client_secret_post"
)

// OIDCClient is a relying party built for one attempt against one connection
// revision.
type OIDCClient struct {
	conn        Connection
	redirectURI string
	party       rp.RelyingParty
	verifier    *rp.IDTokenVerifier
	// userinfo is recorded here because the static constructor has no
	// place for it. Empty under id_token_mapping.
	userinfo string
}

// NewOIDCClient builds the relying party for a connection. Both the
// `authorize` and the `callback` steps use it, so a misconfiguration surfaces
// before the user is redirected rather than after they are authenticated at
// the provider. httpClient must be the hardened egress client: every URL
// fetched here is tenant-authored (ADR 061).
func NewOIDCClient(ctx context.Context, conn Connection, redirectURI string, httpClient *http.Client) (*OIDCClient, error) {
	// A nil client would only fail once a fetch happens, deep inside the
	// library; a connection with endpoints set would hide the wiring bug.
	if httpClient == nil {
		return nil, domain.ErrInternal(errors.New("idp: http client is nil"))
	}
	// ParseConnection guarantees the endpoints are either all set or all
	// empty, so checking one of them is enough to pick the constructor.
	if conn.OIDC.AuthorizationEndpoint == "" {
		return newDiscoveredClient(ctx, conn, redirectURI, httpClient)
	}
	return newStaticClient(conn, redirectURI, httpClient)
}

// RelyingParty exposes the underlying library client.
func (c *OIDCClient) RelyingParty() rp.RelyingParty {
	return c.party
}

// UserinfoEndpoint returns the userinfo URL, or empty when the connection
// maps claims from the id_token.
func (c *OIDCClient) UserinfoEndpoint() string {
	return c.userinfo
}

// IDTokenVerifier returns a copy of the verifier for this connection: issuer,
// client id, key set, and the fixed allowlist. The callback sets the
// per-attempt nonce and clock offset on its copy.
func (c *OIDCClient) IDTokenVerifier() rp.IDTokenVerifier {
	return *c.verifier
}

// newDiscoveredClient builds the relying party from the issuer's discovery
// document, which supplies the endpoints and the jwks_uri.
func newDiscoveredClient(ctx context.Context, conn Connection, redirectURI string, httpClient *http.Client) (*OIDCClient, error) {
	party, err := rp.NewRelyingPartyOIDC(ctx, conn.OIDC.Issuer, conn.OIDC.ClientID, "", redirectURI, conn.OIDC.Scopes,
		rp.WithHTTPClient(httpClient),
		rp.WithVerifierOpts(rp.WithSupportedSigningAlgorithms(SigningAlgorithms()...)))
	if err != nil {
		// The constructor fails only on discovery: fetch, parse, or issuer.
		return nil, domain.ErrIDPDiscoveryFailed(err)
	}
	// The library takes the document's URLs as given. The ones it exposes are
	// re-checked here against the pattern the schema enforces on stored
	// endpoints, so a document cannot send the browser to a cleartext or
	// relative URL. jwks_uri is not exposed: the library keeps it inside its
	// key set, so a cleartext or missing jwks_uri surfaces at the callback's
	// first verification instead. Closing that needs an endpoint getter
	// upstream.
	if err := validDiscovered("authorization_endpoint", party.OAuthConfig().Endpoint.AuthURL); err != nil {
		return nil, err
	}
	if err := validDiscovered("token_endpoint", party.OAuthConfig().Endpoint.TokenURL); err != nil {
		return nil, err
	}
	c := &OIDCClient{conn: conn, redirectURI: redirectURI, party: party, verifier: party.IDTokenVerifier()}
	if !conn.OIDC.IDTokenMapping {
		if err := validDiscovered("userinfo_endpoint", party.UserinfoEndpoint()); err != nil {
			return nil, err
		}
		c.userinfo = party.UserinfoEndpoint()
	}
	return c, nil
}

// newStaticClient builds the relying party from the configured endpoints and
// makes no discovery call.
func newStaticClient(conn Connection, redirectURI string, httpClient *http.Client) (*OIDCClient, error) {
	// The client secret is excluded as the `authorize` request needs none,
	// and the callback resolves it per attempt.
	party, err := rp.NewRelyingPartyOAuth(&oauth2.Config{
		ClientID:    conn.OIDC.ClientID,
		RedirectURL: redirectURI,
		Scopes:      conn.OIDC.Scopes,
		Endpoint: oauth2.Endpoint{
			AuthURL:  conn.OIDC.AuthorizationEndpoint,
			TokenURL: conn.OIDC.TokenEndpoint,
		},
	}, rp.WithHTTPClient(httpClient))
	if err != nil {
		// Only a PKCE-from-discovery option fails here, and none is passed.
		return nil, domain.ErrInternal(err)
	}
	// The static constructor takes no issuer and no jwks_uri, so the
	// verifier it builds has an empty issuer and a key set with no URL. The
	// engine builds its own from the connection, so the callback verifies
	// id_tokens the same way in both modes.
	verifier := rp.NewIDTokenVerifier(conn.OIDC.Issuer, conn.OIDC.ClientID,
		rp.NewRemoteKeySet(httpClient, conn.OIDC.JWKSURI),
		rp.WithSupportedSigningAlgorithms(SigningAlgorithms()...))
	return &OIDCClient{conn: conn, redirectURI: redirectURI, party: party, verifier: verifier, userinfo: conn.OIDC.UserinfoEndpoint}, nil
}

// validDiscovered fails when a discovery document omits a necessary endpoint or
// names one that is not https.
func validDiscovered(name, value string) error {
	if value == "" {
		return domain.ErrIDPDiscoveryFailed(fmt.Errorf("missing %s in discovery", name))
	}
	if !endpointPattern.MatchString(value) {
		return domain.ErrIDPDiscoveryFailed(fmt.Errorf("%s in discovery is not an https endpoint", name))
	}
	return nil
}
