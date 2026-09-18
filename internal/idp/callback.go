package idp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
