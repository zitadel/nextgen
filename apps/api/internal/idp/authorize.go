package idp

import (
	"errors"
	"slices"

	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/domain"
)

// AuthorizeRequest carries the per-attempt values the SSO submission
// supplies from the issued state record: state, the OIDC nonce and the
// PKCE verifier.
type AuthorizeRequest struct {
	State string
	Nonce string
	// PKCEVerifier is read only when the connection enables PKCE.
	PKCEVerifier string
}

// AuthorizeRedirect is the authorize URL to send the browser to, and what
// the state record stores so the callback can verify the response.
// PKCEVerifier is empty when the connection disables PKCE.
type AuthorizeRedirect struct {
	URL          string
	State        string
	Nonce        string
	PKCEVerifier string
	RedirectURI  string
	RevisionID   string
}

// reservedAuthorizeParameters are the keys the engine owns or refuses on the
// authorize request. The schema rejects them in static_authorize_parameters;
// if one reaches the engine anyway, the configured value is dropped.
//
// Dropping is not optional. oauth2.Config.AuthCodeURL first fills the
// engine's parameters, then applies every extra option with url.Values.Set,
// which replaces the existing value under that key. A static "state" or
// "nonce" passed through as an option would therefore overwrite the engine's
// and defeat the CSRF and token binding.
var reservedAuthorizeParameters = []string{
	"client_id",
	"redirect_uri",
	"response_type",
	"scope",
	"state",
	"nonce",
	"code_challenge",
	"code_challenge_method",
	"response_mode",
	"request",
	"request_uri",
	"client_secret",
	"client_assertion",
}

// NewAuthorizeRedirect builds the authorize URL for one attempt. The engine
// sets every protocol parameter itself: client_id, redirect_uri,
// response_type=code, scope, state, nonce, and an S256 code challenge when
// PKCE is enabled. The connection's static parameters follow, minus the
// reserved keys.
func NewAuthorizeRedirect(c *OIDCClient, req AuthorizeRequest) (AuthorizeRedirect, error) {
	if req.State == "" {
		return AuthorizeRedirect{}, domain.ErrInternal(errors.New("authorize request: state is empty"))
	}
	if req.Nonce == "" {
		return AuthorizeRedirect{}, domain.ErrInternal(errors.New("authorize request: nonce is empty"))
	}
	redirect := AuthorizeRedirect{
		State:       req.State,
		Nonce:       req.Nonce,
		RedirectURI: c.redirectURI,
		RevisionID:  c.conn.RevisionID,
	}
	opts := []rp.AuthURLOpt{rp.AuthURLOpt(rp.WithURLParam("nonce", req.Nonce))}
	if c.conn.OIDC.PKCEEnabled {
		if req.PKCEVerifier == "" {
			return AuthorizeRedirect{}, domain.ErrInternal(errors.New("authorize request: pkce verifier is empty"))
		}
		redirect.PKCEVerifier = req.PKCEVerifier
		opts = append(opts, rp.WithCodeChallenge(oidc.NewSHACodeChallenge(req.PKCEVerifier)))
	}
	for key, value := range c.conn.OIDC.StaticAuthorizeParameters {
		if slices.Contains(reservedAuthorizeParameters, key) {
			continue
		}
		opts = append(opts, rp.AuthURLOpt(rp.WithURLParam(key, value)))
	}
	redirect.URL = rp.AuthURL(req.State, c.party, opts...)
	return redirect, nil
}
