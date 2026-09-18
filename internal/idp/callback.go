package idp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"time"

	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"golang.org/x/oauth2"

	"github.com/zitadel/nextgen/internal/domain"
)

// clockSkew is the offset the oidc verifier applies to the time claims. An
// iat up to one minute in the future is accepted, which covers a provider
// clock running ahead. An exp less than one minute away is rejected, the
// same as an expired one.
const clockSkew = time.Minute

// CallbackRequest carries what the callback route hands the engine for one
// attempt.
type CallbackRequest struct {
	// Code is the authorization code from the provider's redirect.
	Code string
	// Nonce and PKCEVerifier are what the state record stored at authorize.
	// PKCEVerifier is empty when the connection disables PKCE.
	Nonce        string
	PKCEVerifier string
	// ClientSecret is the resolved value of the connection's reference,
	// for this call only.
	ClientSecret string
	// SupplementaryFetch is the strategy the connection selects, or nil.
	// The registry that resolves a name to one is #1029.
	SupplementaryFetch SupplementaryFetch
}

// ExternalIdentity is what a completed callback yields: the resolved
// external identity the attempt carries on to identity resolution. It holds
// no provider token; those live only inside Callback.
type ExternalIdentity struct {
	// Subject is the provider's stable identifier as a string; a JSON
	// number arrives as its exact digits.
	Subject string
	// Claims are the provider claims keyed by the user-schema property
	// claim_mapping names, with the raw decoded values.
	Claims map[string]any
	// Verified is the verified_claims outcome per user-schema property.
	Verified map[string]bool
	// RevisionID is the connection revision the attempt pinned.
	RevisionID string
}

// SupplementaryFetch is the supplementary_fetch strategy slot: a provider
// specific call after claims extraction whose result overwrites same-named
// claims and vouches for the ones it verifies.
type SupplementaryFetch func(ctx context.Context, in StrategyInput) (StrategyResult, error)

// StrategyInput is what a strategy runs with.
type StrategyInput struct {
	Connection  Connection
	AccessToken string
	TokenType   string
	// HTTPClient is the egress client; every strategy URL is tenant-served.
	HTTPClient *http.Client
}

// StrategyResult is what a strategy emits. Both maps are keyed by provider
// claim name. An empty result is not a failure: the strategy emits nothing
// and the extracted claims stand, unverified.
type StrategyResult struct {
	Claims   map[string]any
	Verified map[string]bool
}

// Callback completes the ceremony for one attempt: exchanges the code,
// verifies the id_token, extracts claims, runs the strategy, evaluates
// verification, and coerces the subject. The provider's tokens are dropped
// when it returns.
func (c *OIDCClient) Callback(ctx context.Context, req CallbackRequest) (ExternalIdentity, error) {
	if req.Code == "" {
		return ExternalIdentity{}, domain.ErrInternal(errors.New("callback: code is empty"))
	}
	token, err := c.exchange(ctx, req.Code, req.PKCEVerifier, req.ClientSecret)
	if err != nil {
		return ExternalIdentity{}, err
	}
	idToken, err := c.verifyIDToken(ctx, token, req.Nonce)
	if err != nil {
		return ExternalIdentity{}, err
	}
	claims, err := c.extractClaims(ctx, token, idToken)
	if err != nil {
		return ExternalIdentity{}, err
	}
	var strategy StrategyResult
	if req.SupplementaryFetch != nil {
		strategy, err = req.SupplementaryFetch(ctx, StrategyInput{
			Connection:  c.conn,
			AccessToken: token.AccessToken,
			TokenType:   token.Type(),
			HTTPClient:  c.party.HttpClient(),
		})
		if err != nil {
			return ExternalIdentity{}, domain.ErrIDPSupplementaryFetchFailed(err)
		}
		// The strategy is the authority for the claims it emits.
		maps.Copy(claims, strategy.Claims)
	}
	subject, err := coerceSubject(c.conn.SubjectClaim, claims)
	if err != nil {
		return ExternalIdentity{}, err
	}
	return ExternalIdentity{
		Subject:    subject,
		Claims:     mapClaims(c.conn.ClaimMapping, claims),
		Verified:   evaluateVerified(c.conn, claims, strategy),
		RevisionID: c.conn.RevisionID,
	}, nil
}

// exchange trades the authorization code for the provider's tokens.
func (c *OIDCClient) exchange(ctx context.Context, code, pkceVerifier, clientSecret string) (*oauth2.Token, error) {
	// The secret is set either in the Authorization header or the request
	// body, based on the token_endpoint_auth_method set in the connection:
	// the Authorization header for client_secret_basic, the form body for
	// client_secret_post. Left unset, oauth2 probes the endpoint: header
	// first and, if that is refused, body.
	var style oauth2.AuthStyle
	switch c.conn.OIDC.TokenEndpointAuthMethod {
	case ClientSecretBasic:
		style = oauth2.AuthStyleInHeader
	case ClientSecretPost:
		style = oauth2.AuthStyleInParams
	default:
		return nil, domain.ErrInternal(fmt.Errorf("unknown token endpoint auth method %q", c.conn.OIDC.TokenEndpointAuthMethod))
	}
	var opts []oauth2.AuthCodeOption
	if c.conn.OIDC.PKCEEnabled {
		// The state record holds the verifier from the authorize request.
		if pkceVerifier == "" {
			return nil, domain.ErrInternal(errors.New("callback: pkce verifier is empty"))
		}
		opts = append(opts, oauth2.SetAuthURLParam("code_verifier", pkceVerifier))
	}
	// Built here rather than taken from the relying party, which has no
	// client secret.
	config := oauth2.Config{
		ClientID:     c.conn.OIDC.ClientID,
		ClientSecret: clientSecret,
		RedirectURL:  c.redirectURI,
		Endpoint:     oauth2.Endpoint{TokenURL: c.party.OAuthConfig().Endpoint.TokenURL, AuthStyle: style},
	}
	// oauth2 reads the http client from the context; this is the egress
	// client the relying party was built with.
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.party.HttpClient())
	token, err := config.Exchange(ctx, code, opts...)
	if err != nil {
		return nil, domain.ErrIDPExchangeFailed(err)
	}
	return token, nil
}

// verifyIDToken checks the id_token from the token response against the
// attempt and returns its claims.
func (c *OIDCClient) verifyIDToken(ctx context.Context, token *oauth2.Token, nonce string) (*oidc.IDTokenClaims, error) {
	if nonce == "" {
		return nil, domain.ErrInternal(errors.New("callback: nonce is empty"))
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return nil, domain.ErrIDPIDTokenInvalid(rp.ErrMissingIDToken)
	}
	// A copy of the connection's verifier, so the nonce is per attempt
	// while the key set and its JWKS cache are shared.
	verifier := c.IDTokenVerifier()
	verifier.Nonce = func(context.Context) string { return nonce }
	verifier.Offset = clockSkew
	// Checks the signature, iss, aud with azp, exp and iat, nonce, and
	// at_hash when present.
	claims, err := rp.VerifyTokens[*oidc.IDTokenClaims](ctx, token.AccessToken, raw, &verifier)
	if err != nil {
		return nil, domain.ErrIDPIDTokenInvalid(err)
	}
	return claims, nil
}

// extractClaims returns the claim set the connection maps from: the
// id_token payload when id_token_mapping is set, otherwise the userinfo
// response. Numbers stay json.Number so a subject like 9007199254740993
// keeps its exact digits.
func (c *OIDCClient) extractClaims(ctx context.Context, token *oauth2.Token, idToken *oidc.IDTokenClaims) (map[string]any, error) {
	if c.conn.OIDC.IDTokenMapping {
		// verifyIDToken accepted the token, so it has three segments.
		raw, _ := token.Extra("id_token").(string)
		payload, err := base64.RawURLEncoding.DecodeString(strings.Split(raw, ".")[1])
		if err != nil {
			return nil, domain.ErrIDPIDTokenInvalid(err)
		}
		claims, err := decodeClaims(bytes.NewReader(payload))
		if err != nil {
			return nil, domain.ErrIDPIDTokenInvalid(err)
		}
		return claims, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.userinfo, nil)
	if err != nil {
		return nil, domain.ErrInternal(err)
	}
	req.Header.Set("Authorization", token.Type()+" "+token.AccessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := c.party.HttpClient().Do(req)
	if err != nil {
		return nil, domain.ErrIDPUserinfoFailed(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, domain.ErrIDPUserinfoFailed(fmt.Errorf("userinfo: unexpected status %d", resp.StatusCode))
	}
	claims, err := decodeClaims(resp.Body)
	if err != nil {
		return nil, domain.ErrIDPUserinfoFailed(err)
	}
	// OIDC Core 5.3.2: without this, a provider mixup could attach another
	// subject's claims to this attempt.
	if claims["sub"] != idToken.Subject {
		return nil, domain.ErrIDPUserinfoFailed(rp.ErrUserInfoSubNotMatching)
	}
	return claims, nil
}

// mapClaims keys the provider claims by user-schema property. A property
// whose claim is absent is left out.
func mapClaims(claimMapping map[string]string, claims map[string]any) map[string]any {
	mapped := make(map[string]any, len(claimMapping))
	for property, claim := range claimMapping {
		if value, ok := claims[claim]; ok {
			mapped[property] = value
		}
	}
	return mapped
}

// evaluateVerified applies each verified_claims entry.
func evaluateVerified(conn Connection, claims map[string]any, strategy StrategyResult) map[string]bool {
	verified := make(map[string]bool, len(conn.VerifiedClaims))
	for property, source := range conn.VerifiedClaims {
		switch source.Kind {
		case VerifyByTrust:
			verified[property] = true
		case VerifyByClaim:
			// The boolean true or the string "true"; anything else,
			// including an absent claim, is unverified.
			verified[property] = claims[source.Claim] == true || claims[source.Claim] == "true"
		case VerifyByStrategy:
			// The strategy reports by provider claim name, so the property
			// is first mapped to its claim. An unmapped property is
			// unverified.
			verified[property] = strategy.Verified[conn.ClaimMapping[property]]
		}
	}
	return verified
}

// coerceSubject reads the subject claim as a string. A JSON number becomes
// its exact decimal text; every other shape is refused, since the stored
// subject keys the identity and must be a string. The cause names the
// shape, never the value.
func coerceSubject(claim string, claims map[string]any) (string, error) {
	value, ok := claims[claim]
	if !ok {
		return "", domain.ErrIDPSubjectInvalid(fmt.Errorf("subject claim %s is absent", claim))
	}
	switch v := value.(type) {
	case string:
		if v == "" {
			return "", domain.ErrIDPSubjectInvalid(fmt.Errorf("subject claim %s is empty", claim))
		}
		return v, nil
	case json.Number:
		return v.String(), nil
	default:
		return "", domain.ErrIDPSubjectInvalid(fmt.Errorf("subject claim %s is %T", claim, value))
	}
}

// decodeClaims decodes one JSON object with numbers kept as json.Number.
func decodeClaims(r io.Reader) (map[string]any, error) {
	dec := json.NewDecoder(r)
	dec.UseNumber()
	var claims map[string]any
	if err := dec.Decode(&claims); err != nil {
		return nil, err
	}
	return claims, nil
}
