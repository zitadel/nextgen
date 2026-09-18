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
// Provisioning is read by identity resolution and is not part of this view
// yet.
type Connection struct {
	RevisionID string
	// SubjectClaim names the claim carrying the provider's stable subject.
	// Defaults to sub for OIDC.
	SubjectClaim string
	// ClaimMapping maps a user-schema property name to the provider claim.
	ClaimMapping map[string]string
	// VerifiedClaims maps a user-schema property name to the source that
	// decides whether the property arrived verified.
	VerifiedClaims map[string]VerificationSource
	OIDC           OIDCConnection
}

// VerificationSource is a verified_claims value in typed form. The stored
// value is a boolean, a $-pointer, or a claim name; Kind says which, so the
// callback switches on it instead of re-inspecting the raw JSON.
type VerificationSource struct {
	Kind VerificationKind
	// Claim is the provider claim read when Kind is VerifyByClaim.
	Claim string
}

// VerificationKind is the form a verified_claims value takes.
type VerificationKind string

const (
	// VerifyByClaim is a stored claim name such as "email_verified": the
	// property is verified when that claim arrives as the boolean true or
	// the string "true".
	VerifyByClaim VerificationKind = "claim"
	// VerifyByTrust is the stored boolean true: the provider's word is
	// taken, so the property is verified on every attempt.
	VerifyByTrust VerificationKind = "trust"
	// VerifyByStrategy is the stored "$supplementary_fetch": the property
	// is verified when the selected strategy reports its mapped claim as
	// verified.
	VerifyByStrategy VerificationKind = "strategy"
)

// strategyPointer is the only $-value the schema defines.
const strategyPointer = "$supplementary_fetch"

// connectionBody mirrors the stored revision. Pointers mark the fields whose
// absence means "apply the engine default".
type connectionBody struct {
	Protocol       string            `json:"protocol"`
	SubjectClaim   string            `json:"subject_claim"`
	ClaimMapping   map[string]string `json:"claim_mapping"`
	VerifiedClaims map[string]any    `json:"verified_claims"`
	OIDC           *oidcBody         `json:"oidc"`
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
	if err := requireAllOrNoEndpoints(oidc); err != nil {
		return Connection{}, err
	}

	conn := Connection{
		RevisionID:     revisionID,
		SubjectClaim:   stored.SubjectClaim,
		ClaimMapping:   stored.ClaimMapping,
		VerifiedClaims: parseVerifiedClaims(stored.VerifiedClaims),
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

// parseVerifiedClaims turns each raw verified_claims value into a
// VerificationSource. The schema's rules are not re-checked: an unknown $
// value read as a claim name matches nothing, and a value that is neither a
// string nor true is dropped, so either evaluates as unverified, the same as
// an absent entry.
func parseVerifiedClaims(stored map[string]any) map[string]VerificationSource {
	// An absent block stays nil, as ClaimMapping does.
	if stored == nil {
		return nil
	}
	sources := make(map[string]VerificationSource, len(stored))
	for property, value := range stored {
		switch v := value.(type) {
		case bool:
			if v {
				sources[property] = VerificationSource{Kind: VerifyByTrust}
			}
		case string:
			if v == strategyPointer {
				sources[property] = VerificationSource{Kind: VerifyByStrategy}
				continue
			}
			sources[property] = VerificationSource{Kind: VerifyByClaim, Claim: v}
		}
	}
	return sources
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

// requireAllOrNoEndpoints enforces the two supported shapes:
// 1. no endpoint set: fetched from the discovery document.
// 2. every endpoint the connection needs is set: requires no discovery.
func requireAllOrNoEndpoints(oidc *oidcBody) error {
	endpoints := map[string]string{
		"authorization_endpoint": oidc.AuthorizationEndpoint,
		"token_endpoint":         oidc.TokenEndpoint,
		"jwks_uri":               oidc.JWKSURI,
	}
	if !oidc.IDTokenMapping {
		endpoints["userinfo_endpoint"] = oidc.UserinfoEndpoint
	}
	var missing []string
	for name, value := range endpoints {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) == 0 || len(missing) == len(endpoints) {
		return nil
	}
	slices.Sort(missing)
	return domain.ErrIDPEndpointsPartial(missing)
}

// validEndpoint reports whether an endpoint is unset or matches the schema
// pattern.
func validEndpoint(endpoint string) bool {
	return endpoint == "" || endpointPattern.MatchString(endpoint)
}
