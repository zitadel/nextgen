// Package idp is the identity-provider engine: it turns a pinned connection
// revision into a relying-party client and drives the sign-in ceremony with
// it. It reads no storage and serves no routes; callers hand it the revision
// and the hardened egress client.
package idp

import (
	"context"
	"fmt"
	"net/http"

	"github.com/zitadel/oidc/v3/pkg/client"
	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"golang.org/x/oauth2"

	"github.com/zitadel/nextgen/internal/domain"
)

// OIDCConnection is the engine's view of the OIDC block of a connection
// revision. Each endpoint field overrides the discovered one; empty means it
// comes from the issuer's discovery document.
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

// Endpoints is the resolved set the ceremony uses. Userinfo is empty when
// the connection maps claims from the id_token.
type Endpoints struct {
	Authorization string
	Token         string
	Userinfo      string
	JWKS          string
}

// OIDCClient is a relying party built for one attempt against one connection
// revision.
type OIDCClient struct {
	party     rp.RelyingParty
	endpoints Endpoints
}

// NewOIDCClient resolves every endpoint the ceremony needs and builds the
// relying party over them. Both the `authorize` and the `callback` step use it,
// so a misconfiguration surfaces before the user is redirected rather than
// after they are authenticated at the provider. Discovery is fetched once, only
// when an override is missing, so a fully overridden connection makes no
// request. httpClient must be the hardened egress client: every URL fetched
// here is tenant-authored (ADR 061).
func NewOIDCClient(ctx context.Context, conn OIDCConnection, redirectURI string, httpClient *http.Client) (*OIDCClient, error) {
	endpoints, err := resolveEndpoints(ctx, conn, httpClient)
	if err != nil {
		return nil, err
	}
	// The static constructor: it takes the endpoints as given instead of
	// running discovery itself, which is what lets overrides skip the fetch.
	// The secret is absent by design; the `authorize` request needs none, and
	// the callback resolves it per attempt.
	party, err := rp.NewRelyingPartyOAuth(&oauth2.Config{
		ClientID:    conn.ClientID,
		RedirectURL: redirectURI,
		Scopes:      conn.Scopes,
		Endpoint: oauth2.Endpoint{
			AuthURL:  endpoints.Authorization,
			TokenURL: endpoints.Token,
		},
	}, rp.WithHTTPClient(httpClient))
	if err != nil {
		// Only a PKCE-from-discovery option fails here, and none is passed.
		return nil, domain.ErrInternal(err)
	}
	return &OIDCClient{party: party, endpoints: endpoints}, nil
}

func resolveEndpoints(ctx context.Context, conn OIDCConnection, httpClient *http.Client) (Endpoints, error) {
	endpoints := Endpoints{
		Authorization: conn.AuthorizationEndpoint,
		Token:         conn.TokenEndpoint,
		JWKS:          conn.JWKSURI,
	}
	needsUserinfo := !conn.IDTokenMapping
	if needsUserinfo {
		endpoints.Userinfo = conn.UserinfoEndpoint
	}
	// When there are overrides set, they take precedence over discovery.
	// A connection that overrides all the endpoints does not need a discovery call.
	if endpoints.Authorization != "" && endpoints.Token != "" && endpoints.JWKS != "" &&
		(!needsUserinfo || endpoints.Userinfo != "") {
		return endpoints, nil
	}
	discovered, err := client.Discover(ctx, conn.Issuer, httpClient)
	if err != nil {
		return Endpoints{}, domain.ErrIDPDiscoveryFailed(err)
	}
	if err := overrideOrDiscovered(&endpoints.Authorization, discovered.AuthorizationEndpoint, "authorization_endpoint"); err != nil {
		return Endpoints{}, err
	}
	if err := overrideOrDiscovered(&endpoints.Token, discovered.TokenEndpoint, "token_endpoint"); err != nil {
		return Endpoints{}, err
	}
	if err := overrideOrDiscovered(&endpoints.JWKS, discovered.JwksURI, "jwks_uri"); err != nil {
		return Endpoints{}, err
	}
	if needsUserinfo {
		if err := overrideOrDiscovered(&endpoints.Userinfo, discovered.UserinfoEndpoint, "userinfo_endpoint"); err != nil {
			return Endpoints{}, err
		}
	}
	return endpoints, nil
}

// overrideOrDiscovered keeps the override in dst, takes the discovered value
// when there is none, and fails when neither names the endpoint.
func overrideOrDiscovered(dst *string, discovered, name string) error {
	if *dst != "" {
		return nil
	}
	if discovered == "" {
		return domain.ErrIDPDiscoveryFailed(fmt.Errorf("missing %s in discovery", name))
	}
	*dst = discovered
	return nil
}

// RelyingParty exposes the underlying library client.
func (c *OIDCClient) RelyingParty() rp.RelyingParty {
	return c.party
}

// Endpoints returns the resolved endpoint set.
func (c *OIDCClient) Endpoints() Endpoints {
	return c.endpoints
}
