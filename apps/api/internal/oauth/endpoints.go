// Package oauth serves the OAuth 2.0 authorization server of a project. One
// handler answers every project's issuer under Prefix: a project's issuer is
// the origin its login app is served from, plus the SDK proxy's prefix when
// the request came through it, plus "/oauth/{project_id}". The empty tenant,
// "/oauth" itself, is the platform project's issuer on the server's public
// base.
//
// The package wires the metadata server and the OP handler of
// github.com/zitadel/oidc/v3/pkg/op. Every endpoint not implemented yet
// answers 404, with the error page for a browser.
package oauth

import "github.com/zitadel/oidc/v3/pkg/op"

// Prefix is the path every issuer this server serves lives under. The
// project ID follows it as one path segment; the platform project's issuer
// is the prefix itself.
const Prefix = "/oauth"

// The endpoints of an issuer, relative to the issuer URL for the ones a
// browser visits and to the project's back-channel base for the others
// (see EndpointFactory). Introspection is not served (ADR 082 §2); device
// authorization comes later.
const (
	AuthorizePath  = "/authorize"
	TokenPath      = "/token"
	RevokePath     = "/revoke"
	JWKSPath       = "/jwks"
	UserinfoPath   = "/userinfo"
	EndSessionPath = "/end_session"
)

// opEndpoints are the routes the OP handler registers, relative to the
// tenant, so that "/oauth/{project_id}/token" is that project's token
// endpoint. An endpoint left nil is not routed.
func opEndpoints() op.Endpoints {
	return op.Endpoints{
		Authorization: op.NewEndpoint(AuthorizePath),
		Token:         op.NewEndpoint(TokenPath),
		Revocation:    op.NewEndpoint(RevokePath),
		JwksURI:       op.NewEndpoint(JWKSPath),
		Userinfo:      op.NewEndpoint(UserinfoPath),
		EndSession:    op.NewEndpoint(EndSessionPath),
	}
}
