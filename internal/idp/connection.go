package idp

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
)

// The connection schema's URL patterns: https, or http only for the local
// development hosts. The issuer takes no query string, an endpoint may.
var (
	issuerPattern   = regexp.MustCompile(`^(https://[^\s/?#]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)(/[^\s?#]*)?$`)
	endpointPattern = regexp.MustCompile(`^(https://[^\s/?#]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)([/?][^\s#]*)?$`)
)

// Connection is the engine's view of a pinned connection revision: the body
// decoded, defaults applied, and the rules an attempt relies on re-checked.
// Claim mapping, verification, and provisioning are read by the callback
// tickets and are not part of this view yet.
type Connection struct {
	RevisionID string
	// SubjectClaim names the claim carrying the provider's stable subject.
	// Defaults to sub for OIDC.
	SubjectClaim string
	OIDC         OIDCConnection
}

// connectionBody mirrors the stored revision. Pointers mark the fields whose
// absence means "apply the engine default".
type connectionBody struct {
	Protocol     string    `json:"protocol"`
	SubjectClaim string    `json:"subject_claim"`
	OIDC         *oidcBody `json:"oidc"`
}

type oidcBody struct {
	Issuer                    string            `json:"issuer"`
	JWKSURI                   string            `json:"jwks_uri"`
	IDTokenMapping            bool              `json:"id_token_mapping"`
	AuthorizationEndpoint     string            `json:"authorization_endpoint"`
	TokenEndpoint             string            `json:"token_endpoint"`
	UserinfoEndpoint          string            `json:"userinfo_endpoint"`
	ClientID                  string            `json:"client_id"`
	ClientSecret              string            `json:"client_secret"`
	TokenEndpointAuthMethod   string            `json:"token_endpoint_auth_method"`
	Scopes                    []string          `json:"scopes"`
	PKCEEnabled               *bool             `json:"pkce_enabled"`
	StaticAuthorizeParameters map[string]string `json:"static_authorize_parameters"`
}

// ParseConnection turns a stored revision into the engine's view. The schema
// already enforced the rules re-checked here during create/revise, so a rejection
// means the stored body cannot serve an attempt, not that a request was bad.
func ParseConnection(revisionID string, body []byte) (Connection, error) {
	var stored connectionBody
	if err := json.Unmarshal(body, &stored); err != nil {
		return Connection{}, domain.ErrInternal(fmt.Errorf("decode connection revision: %w", err))
	}
	switch stored.Protocol {
	case "oidc":
	case "oauth2":
		return Connection{}, domain.ErrIDPOAuth2Unsupported()
	default:
		return Connection{}, domain.ErrInternal(fmt.Errorf("unknown protocol %q", stored.Protocol))
	}
	if stored.OIDC == nil {
		return Connection{}, domain.ErrIDPProtocolBlockMissing("oidc")
	}
	oidc := stored.OIDC
	if !slices.Contains(oidc.Scopes, "openid") {
		return Connection{}, domain.ErrIDPScopesMissingOpenID()
	}
	if err := requireTLS(oidc); err != nil {
		return Connection{}, err
	}

	conn := Connection{
		RevisionID:   revisionID,
		SubjectClaim: stored.SubjectClaim,
		OIDC: OIDCConnection{
			Issuer:                    oidc.Issuer,
			ClientID:                  oidc.ClientID,
			ClientSecretRef:           oidc.ClientSecret,
			TokenEndpointAuthMethod:   TokenEndpointAuthMethod(oidc.TokenEndpointAuthMethod),
			Scopes:                    oidc.Scopes,
			PKCEEnabled:               true, // PKCE defaults to true.
			StaticAuthorizeParameters: oidc.StaticAuthorizeParameters,
			AuthorizationEndpoint:     oidc.AuthorizationEndpoint,
			TokenEndpoint:             oidc.TokenEndpoint,
			UserinfoEndpoint:          oidc.UserinfoEndpoint,
			JWKSURI:                   oidc.JWKSURI,
			IDTokenMapping:            oidc.IDTokenMapping,
		},
	}
	if conn.SubjectClaim == "" {
		conn.SubjectClaim = "sub"
	}
	if conn.OIDC.TokenEndpointAuthMethod == "" {
		conn.OIDC.TokenEndpointAuthMethod = ClientSecretBasic
	}
	// update PKCE if explicitly set to false in the connection.
	if oidc.PKCEEnabled != nil {
		conn.OIDC.PKCEEnabled = *oidc.PKCEEnabled
	}
	return conn, nil
}

// requireTLS re-checks the schema's URL patterns on every endpoint the block
// sets. The error names the offending field, never a URL.
func requireTLS(oidc *oidcBody) error {
	if !issuerPattern.MatchString(oidc.Issuer) {
		return domain.ErrIDPEndpointCleartext("issuer")
	}
	if !validEndpoint(oidc.JWKSURI) {
		return domain.ErrIDPEndpointCleartext("jwks_uri")
	}
	if !validEndpoint(oidc.AuthorizationEndpoint) {
		return domain.ErrIDPEndpointCleartext("authorization_endpoint")
	}
	if !validEndpoint(oidc.TokenEndpoint) {
		return domain.ErrIDPEndpointCleartext("token_endpoint")
	}
	if !validEndpoint(oidc.UserinfoEndpoint) {
		return domain.ErrIDPEndpointCleartext("userinfo_endpoint")
	}
	return nil
}

// validEndpoint reports whether an endpoint is unset or matches the schema
// pattern.
func validEndpoint(endpoint string) bool {
	return endpoint == "" || endpointPattern.MatchString(endpoint)
}
