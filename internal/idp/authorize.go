package idp

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"slices"

	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/domain"
)

// AuthorizeRequest carries the per-attempt values the SSO submission
// supplies: state from the state record, nonce and the PKCE verifier from
// [NewNonce] and [NewPKCEVerifier].
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

// Authorize builds the authorize URL for one attempt. The engine sets every
// protocol parameter itself: client_id, redirect_uri, response_type=code,
// scope, state, nonce, and an S256 code challenge when PKCE is enabled. The
// connection's static parameters follow, minus the reserved keys.
func (c *OIDCClient) Authorize(req AuthorizeRequest) (AuthorizeRedirect, error) {
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

// NewNonce returns the nonce for one authorize request.
func NewNonce() string {
	return randomToken()
}

// NewPKCEVerifier returns the PKCE code verifier for one authorize request.
func NewPKCEVerifier() string {
	return randomToken()
}

// randomToken draws 256 bits from the CSPRNG. That is above the 128-bit
// floor the ceremony sets for state, and its 43 unreserved characters are
// the minimum RFC 7636 sets for a code verifier.
func randomToken() string {
	b := make([]byte, 32)
	// crypto/rand.Read never returns an error; it terminates the program
	// if the source fails.
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
