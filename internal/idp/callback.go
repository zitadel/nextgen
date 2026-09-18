package idp

import (
	"context"
	"errors"
	"fmt"

	"golang.org/x/oauth2"

	"github.com/zitadel/nextgen/internal/domain"
)

// exchange trades the authorization code for the provider's tokens. The
// party from construction carries no secret, so the request is built from a
// config of its own with the secret and the auth style for this call. The
// style is explicit: the library's default probes header auth and retries
// with the secret in the body when the endpoint refuses, which would send a
// client_secret_basic secret in a form the connection never agreed to. The
// request goes through the egress client the party was built with.
//
// The verifier is sent when the connection enables PKCE and is required
// then; the state record holds the one from the authorize request.
func (c *OIDCClient) exchange(ctx context.Context, code, pkceVerifier, clientSecret string) (*oauth2.Token, error) {
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
		if pkceVerifier == "" {
			return nil, domain.ErrInternal(errors.New("callback: pkce verifier is empty"))
		}
		opts = append(opts, oauth2.SetAuthURLParam("code_verifier", pkceVerifier))
	}
	config := oauth2.Config{
		ClientID:     c.conn.OIDC.ClientID,
		ClientSecret: clientSecret,
		RedirectURL:  c.redirectURI,
		Endpoint:     oauth2.Endpoint{TokenURL: c.party.OAuthConfig().Endpoint.TokenURL, AuthStyle: style},
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.party.HttpClient())
	token, err := config.Exchange(ctx, code, opts...)
	if err != nil {
		return nil, domain.ErrIDPExchangeFailed(err)
	}
	return token, nil
}
