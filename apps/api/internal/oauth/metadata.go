package oauth

import (
	"context"
	"net/http"

	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
)

// authorizationServerMetadata is the RFC 8414 §2 document of an issuer, with
// the fields of the profile this server offers: the authorization code grant
// with PKCE, for confidential clients. It is this server's own type rather
// than [oidc.DiscoveryConfiguration], which always emits the OIDC-only
// request_uri_parameter_supported; every field here is an RFC 8414 one and
// an empty one is left out.
type authorizationServerMetadata struct {
	Issuer                            string                     `json:"issuer"`
	AuthorizationEndpoint             string                     `json:"authorization_endpoint,omitempty"`
	TokenEndpoint                     string                     `json:"token_endpoint,omitempty"`
	JWKSURI                           string                     `json:"jwks_uri,omitempty"`
	ResponseTypesSupported            []oidc.ResponseType        `json:"response_types_supported,omitempty"`
	ResponseModesSupported            []oidc.ResponseMode        `json:"response_modes_supported,omitempty"`
	GrantTypesSupported               []oidc.GrantType           `json:"grant_types_supported,omitempty"`
	TokenEndpointAuthMethodsSupported []oidc.AuthMethod          `json:"token_endpoint_auth_methods_supported,omitempty"`
	CodeChallengeMethodsSupported     []oidc.CodeChallengeMethod `json:"code_challenge_methods_supported,omitempty"`
}

// metadataServer answers the well-known metadata paths for every issuer. It
// serves RFC 8414 metadata for an issuer the request admitted whose project
// has OAuth enabled, and a 404 for everything else, OpenID Connect
// Discovery included until there is an OIDC layer.
type metadataServer struct {
	op.UnimplementedMetadataServer
	settings  SettingsSource
	endpoints EndpointFactory
}

func (m metadataServer) AuthorizationServerMetadata(ctx context.Context, _ *op.Request[op.MetadataRequest]) (*op.Response, error) {
	issuer, ok := IssuerFromContext(ctx)
	if !ok {
		return nil, metadataError(issuerError(ctx))
	}
	settings, err := m.settings.Get(ctx, issuer)
	if err != nil {
		return nil, metadataError(err)
	}
	if !settings.Enabled {
		return nil, noMetadata()
	}
	urls := m.endpoints.For(issuer)
	return op.NewResponse(authorizationServerMetadata{
		Issuer:                            issuer.URL.String(),
		AuthorizationEndpoint:             urls.Authorization,
		TokenEndpoint:                     urls.Token,
		JWKSURI:                           urls.JWKS,
		ResponseTypesSupported:            []oidc.ResponseType{oidc.ResponseTypeCode},
		ResponseModesSupported:            []oidc.ResponseMode{oidc.ResponseModeQuery},
		GrantTypesSupported:               []oidc.GrantType{oidc.GrantTypeCode},
		TokenEndpointAuthMethodsSupported: []oidc.AuthMethod{oidc.AuthMethodBasic, oidc.AuthMethodPost},
		CodeChallengeMethodsSupported:     []oidc.CodeChallengeMethod{oidc.CodeChallengeMethodS256},
	}), nil
}

// OpenIDConfiguration answers OpenID Connect Discovery with a 404 for every
// issuer. The server is an OAuth 2.0 authorization server only for now: it
// issues no ID token, so it cannot fill the fields Discovery requires, such
// as id_token_signing_alg_values_supported (which must list RS256) and
// subject_types_supported. Clients find the server through the RFC 8414
// document instead. This returns the document once the OIDC layer exists.
func (metadataServer) OpenIDConfiguration(context.Context, *op.Request[op.MetadataRequest]) (*op.Response, error) {
	return nil, noMetadata()
}

// noMetadata is the answer for an issuer this server does not serve
// (RFC 8414 §3.3).
func noMetadata() error {
	return op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("no authorization server at this issuer"), http.StatusNotFound)
}

// metadataError turns the reason a request has no metadata into the
// response: a server fault is a 500, because the server could not decide;
// anything else means "no" and is the 404 of an unknown issuer.
func metadataError(err error) error {
	if domain.IsServerFault(err) {
		return op.NewStatusError(oidc.ErrServerError().WithParent(err), http.StatusInternalServerError)
	}
	return noMetadata()
}
