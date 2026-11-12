package oauth

import (
	"context"
	"net/url"
	"slices"
	"time"

	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
)

// ClientResolver finds a client in the release a deployment serves, or among
// the project's registered applications (ADR 082 §3). An unknown client is
// [domain.ErrApplicationNotFound].
type ClientResolver interface {
	Client(ctx context.Context, projectID, deploymentID, clientID string) (domain.ApplicationClientDocument, error)
}

// client is a client as the library reads it, for one authorization request.
// Phase 1 has only confidential web clients on the authorization code grant.
type client struct {
	id           string
	redirectURIs []string
	grantTypes   []oidc.GrantType
	// settings are the issuer's, read when the client was resolved, so
	// Authorize stores the deployment the client came from.
	settings Settings
}

// newClient wraps doc, the client holding clientID, for the request to
// requestedRedirectURI. A loopback redirect URI matches a registered one on
// any port (RFC 8252 §7.3), so the requested URI joins the registered ones
// when only its port differs. The library does this for native clients
// alone.
func newClient(clientID string, doc domain.ApplicationClientDocument, requestedRedirectURI string) *client {
	c := &client{id: clientID, redirectURIs: doc.RedirectURIs}
	if !slices.Contains(doc.RedirectURIs, requestedRedirectURI) && slices.ContainsFunc(doc.RedirectURIs, func(registered string) bool {
		return loopbackOnOtherPort(requestedRedirectURI, registered)
	}) {
		c.redirectURIs = append(slices.Clip(doc.RedirectURIs), requestedRedirectURI)
	}
	for _, grant := range doc.GrantTypes {
		c.grantTypes = append(c.grantTypes, oidc.GrantType(grant))
	}
	return c
}

func (c *client) GetID() string                       { return c.id }
func (c *client) RedirectURIs() []string              { return c.redirectURIs }
func (c *client) PostLogoutRedirectURIs() []string    { return nil }
func (c *client) ApplicationType() op.ApplicationType { return op.ApplicationTypeWeb }
func (c *client) AuthMethod() oidc.AuthMethod         { return oidc.AuthMethodBasic }
func (c *client) ResponseTypes() []oidc.ResponseType {
	return []oidc.ResponseType{oidc.ResponseTypeCode}
}
func (c *client) GrantTypes() []oidc.GrantType                                 { return c.grantTypes }
func (c *client) AccessTokenType() op.AccessTokenType                          { return op.AccessTokenTypeBearer }
func (c *client) IDTokenLifetime() time.Duration                               { return 0 }
func (c *client) DevMode() bool                                                { return false }
func (c *client) IsScopeAllowed(string) bool                                   { return false }
func (c *client) IDTokenUserinfoClaimsAssertion() bool                         { return false }
func (c *client) ClockSkew() time.Duration                                     { return 0 }
func (c *client) RestrictAdditionalIdTokenScopes() func([]string) []string     { return nil }
func (c *client) RestrictAdditionalAccessTokenScopes() func([]string) []string { return nil }

// LoginURL is only read by the library's legacy server; Authorize builds the
// login redirect itself.
func (c *client) LoginURL(string) string { return "" }

var _ op.Client = (*client)(nil)

// loopbackOnOtherPort reports whether requested is the loopback URI
// registered apart from its port. requested comes from the request, so it is
// parsed as a redirect target and must already be in canonical form, as
// every registered URI is.
func loopbackOnOtherPort(requested, registered string) bool {
	r, err := url.Parse(registered)
	if err != nil || r.Scheme != "http" || !domain.IsLoopbackOrigin(r.Scheme+"://"+r.Host) {
		return false
	}
	u, err := httputil.ParseRedirectTarget(requested)
	if err != nil || u.String() != requested || u.Hostname() != r.Hostname() {
		return false
	}
	// Only the port may differ: with the registered host and port swapped in,
	// the rest must match exactly.
	u.Host = r.Host
	return u.String() == registered
}
