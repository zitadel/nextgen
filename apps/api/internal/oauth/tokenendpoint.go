package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// refreshPayload is what a refresh token seals. Its record, TokenID, is what
// rotation consumes, under the consent ConsentID names.
type refreshPayload struct {
	ConsentID string   `json:"consent_id"`
	TokenID   string   `json:"token_id"`
	ClientID  string   `json:"client_id"`
	Resource  string   `json:"resource"`
	Scope     []string `json:"scope,omitempty"`
	UserID    string   `json:"user_id"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

// maxFormSize bounds a back-channel request body.
const maxFormSize = 64 << 10

// backChannel serves the token, revocation and JWKS endpoints through
// zitadel/oidc's op.Server: the library routes them, parses their forms and
// client credentials, and encodes their errors (RFC 6749 §5.2), and this
// package answers. Authorization stays outside it: the library renders an
// error its VerifyAuthRequest returns instead of redirecting it, leaves iss
// (RFC 9207) off the error redirects it builds, and has no resource
// parameter (RFC 8707).
type backChannel struct {
	op.UnimplementedServer
	s *Server
}

// newBackChannel is the one handler the back channel's routes share.
func (s *Server) newBackChannel() http.Handler {
	ns := s.namespace()
	handler := op.RegisterServer(backChannel{s: s}, op.Endpoints{
		Token:      op.NewEndpoint(ns + "/token"),
		Revocation: op.NewEndpoint(ns + "/revoke"),
		JwksURI:    op.NewEndpoint(ns + "/jwks"),
	}, op.WithServerCORSOptions(nil)) // cors answers CORS, without credentials (ADR 081 §6)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxFormSize)
		handler.ServeHTTP(w, r)
	})
}

// VerifyClient finds the client a token or revocation request names. Clients
// here are public: PKCE proves a code's client, and nothing else
// authenticates one.
func (b backChannel) VerifyClient(ctx context.Context, r *op.Request[op.ClientCredentials]) (op.Client, error) {
	if r.Header.Get("Authorization") != "" || r.Data.ClientSecret != "" || r.Data.ClientAssertion != "" {
		return nil, invalidClient("Clients here are public: send client_id, not credentials.")
	}
	if err := singleValued(r.Form); err != nil {
		return nil, err
	}
	client, err := b.s.resolveClient(ctx, r.Data.ClientID)
	if errors.Is(err, errUnknownClient) {
		return nil, invalidClient("The client is not known.")
	}
	if err != nil {
		return nil, serverFault(ctx, err)
	}
	return opClient{client: client}, nil
}

// singleValued refuses a repeated parameter (RFC 6749 §3.1) and a second
// resource: a token is for one API (RFC 8707 §2).
func singleValued(form url.Values) error {
	for _, name := range []string{"grant_type", "client_id", "code", "code_verifier", "redirect_uri", "refresh_token", "scope", "token"} {
		if len(form[name]) > 1 {
			return oidc.ErrInvalidRequest().WithDescription("%s is repeated.", name)
		}
	}
	if len(form["resource"]) > 1 {
		return oidc.ErrInvalidTarget().WithDescription("A token is for one API: name one resource.")
	}
	return nil
}

// CodeExchange redeems a code (RFC 6749 §4.1.3). The code is bound to the
// client and the redirect URI it was issued for, and PKCE to the request
// that started it.
func (b backChannel) CodeExchange(ctx context.Context, r *op.ClientRequest[oidc.AccessTokenRequest]) (*op.Response, error) {
	s := b.s
	client := clientOf(r.Client)
	var code codePayload
	if err := s.unseal(ctx, kindCode, r.Data.Code, &code); err != nil {
		if errors.Is(err, errSealed) {
			return nil, oidc.ErrInvalidGrant().WithDescription("The code is not valid or expired.")
		}
		return nil, serverFault(ctx, err)
	}
	resource := r.Form.Get("resource")
	switch {
	case client.ID != code.ClientID:
		return nil, oidc.ErrInvalidGrant().WithDescription("The code was issued to another client.")
	case r.Data.RedirectURI != code.RedirectURI:
		return nil, oidc.ErrInvalidGrant().WithDescription("redirect_uri does not match the authorization request.")
	case verifyPKCE(code.CodeChallenge, r.Data.CodeVerifier) != nil:
		return nil, oidc.ErrInvalidGrant().WithDescription("code_verifier does not match the code_challenge.")
	case resource != "" && resource != code.Resource:
		return nil, oidc.ErrInvalidTarget().WithDescription("The code was issued for another resource.")
	}
	if err := s.consents.RedeemCode(ctx, s.projectID, code.TokenID); err != nil {
		if !errors.Is(err, service.ErrConsentTokenSpent) {
			return nil, serverFault(ctx, err)
		}
		// A code presented twice may have leaked: whatever was issued under
		// its consent goes too (RFC 6749 §4.1.2).
		if err := s.consents.RevokeTokens(ctx, s.projectID, code.ConsentID); err != nil {
			return nil, serverFault(ctx, err)
		}
		return nil, oidc.ErrInvalidGrant().WithDescription("The code was already used.")
	}
	return s.issueTokens(ctx, client, refreshPayload{
		ConsentID: code.ConsentID,
		ClientID:  code.ClientID,
		Resource:  code.Resource,
		Scope:     code.Scope,
		UserID:    code.UserID,
	}, "")
}

// RefreshToken rotates a refresh token (RFC 6749 §6): the next one replaces
// it, and presenting it again revokes every token of its consent (ADR 037).
func (b backChannel) RefreshToken(ctx context.Context, r *op.ClientRequest[oidc.RefreshTokenRequest]) (*op.Response, error) {
	s := b.s
	client := clientOf(r.Client)
	var issued refreshPayload
	if err := s.unseal(ctx, kindRefresh, r.Data.RefreshToken, &issued); err != nil {
		if errors.Is(err, errSealed) {
			return nil, oidc.ErrInvalidGrant().WithDescription("The refresh token is not valid or expired.")
		}
		return nil, serverFault(ctx, err)
	}
	resource := r.Form.Get("resource")
	switch {
	case client.ID != issued.ClientID:
		return nil, oidc.ErrInvalidGrant().WithDescription("The refresh token was issued to another client.")
	case resource != "" && resource != issued.Resource:
		return nil, oidc.ErrInvalidTarget().WithDescription("The refresh token was issued for another resource.")
	}
	// A refresh may narrow the scope, never widen it (RFC 6749 §6). The
	// library's own split keeps empty entries, so the raw value is read.
	if requested := strings.Fields(r.Form.Get("scope")); len(requested) > 0 {
		for _, scope := range requested {
			if !slices.Contains(issued.Scope, scope) {
				return nil, oidc.ErrInvalidScope().WithDescription("A refresh cannot add the scope %s.", scope)
			}
		}
		issued.Scope = requested
	}
	return s.issueTokens(ctx, client, issued, issued.TokenID)
}

// Revocation serves RFC 7009. A refresh token ends, and with it the rotations
// that would have followed it; the user's consent and the client's other
// sign-ins stay. An access token cannot be revoked: nothing stores it, and it
// expires in minutes (ADR 037). Either way the answer is 200, so a caller
// learns nothing about a token it sends.
func (b backChannel) Revocation(ctx context.Context, r *op.ClientRequest[oidc.RevocationRequest]) (*op.Response, error) {
	s := b.s
	var issued refreshPayload
	if err := s.unseal(ctx, kindRefresh, r.Data.Token, &issued); err != nil {
		if !errors.Is(err, errSealed) {
			return nil, serverFault(ctx, err)
		}
		return op.NewResponse(nil), nil
	}
	// RFC 7009 §2.1: a client revokes only its own tokens.
	if issued.ClientID == r.Client.GetID() {
		if err := s.consents.RevokeToken(ctx, s.projectID, issued.TokenID); err != nil {
			return nil, serverFault(ctx, err)
		}
	}
	return op.NewResponse(nil), nil
}

// Keys publishes the keys access tokens are signed with.
func (b backChannel) Keys(ctx context.Context, _ *op.Request[struct{}]) (*op.Response, error) {
	keys, err := b.s.publicKeys(ctx)
	if err != nil {
		return nil, serverFault(ctx, err)
	}
	response := op.NewResponse(keys)
	// A verifier refetches the set when a token names a key it does not
	// hold, so caching the set only spares this endpoint the reads between.
	response.Header = http.Header{"Cache-Control": {"public, max-age=300"}}
	return response, nil
}

// issueTokens mints the access token for the consent's API and, for a
// first-party client or a third party that was granted offline_access, the
// next refresh token: written fresh after a code, rotated from rotateFrom
// after a refresh.
func (s *Server) issueTokens(ctx context.Context, client Client, issued refreshPayload, rotateFrom string) (*op.Response, error) {
	api, access, err := s.target(ctx, client, issued.Resource, false)
	if err != nil {
		return nil, serverFault(ctx, err)
	}
	if !access.Allowed {
		// No app serves the API to this client since the consent began: the
		// token cannot follow it to another (ADR 081 §10).
		return nil, oidc.ErrInvalidTarget().WithDescription("The resource is no longer served to this client.")
	}
	// A user gone from the project, or no longer active in it, such as one
	// whose owning team was deactivated, could not sign in again: the
	// consent's tokens end at their next use.
	user, err := s.users.GetMyUser(ctx, service.GetMyUserInput{Self: s.selfOf(issued.UserID)})
	gone := errors.Is(err, domain.ErrUserNotFound())
	if err != nil && !gone {
		return nil, serverFault(ctx, err)
	}
	if gone || user.Metadata.Status != domain.UserStatusActive {
		if err := s.consents.RevokeTokens(ctx, s.projectID, issued.ConsentID); err != nil {
			return nil, serverFault(ctx, err)
		}
		if gone {
			return nil, oidc.ErrInvalidGrant().WithDescription("The user no longer exists.")
		}
		return nil, oidc.ErrInvalidGrant().WithDescription("The user is not active.")
	}
	var refreshToken string
	if client.mayUse(domain.GrantRefreshToken) && (client.FirstParty || slices.Contains(issued.Scope, "offline_access")) {
		next := service.ConsentToken{
			ProjectID: s.projectID,
			ConsentID: issued.ConsentID,
			UserID:    issued.UserID,
			Scope:     issued.Scope,
			ExpiresAt: s.now().Add(s.cfg.RefreshTokenTTL),
		}
		var (
			tokenID string
			err     error
		)
		if rotateFrom == "" {
			tokenID, err = s.consents.IssueToken(ctx, next)
		} else {
			tokenID, err = s.consents.Rotate(ctx, s.projectID, rotateFrom, next)
		}
		if errors.Is(err, service.ErrConsentTokenSpent) {
			return nil, oidc.ErrInvalidGrant().WithDescription("The refresh token was already used; every token of its consent is revoked.")
		}
		if errors.Is(err, domain.ErrConsentNotFound()) {
			return nil, oidc.ErrInvalidGrant().WithDescription("The consent this token was issued under ended.")
		}
		if err != nil {
			return nil, serverFault(ctx, err)
		}
		issued.TokenID = tokenID
		if refreshToken, err = s.seal(ctx, kindRefresh, issued, s.cfg.RefreshTokenTTL); err != nil {
			return nil, serverFault(ctx, err)
		}
	} else if rotateFrom != "" {
		// A third party without offline_access never got a refresh token.
		return nil, oidc.ErrInvalidGrant().WithDescription("The refresh token is not valid.")
	}
	accessToken, expires, err := s.mintAccessToken(ctx, issued.UserID, client.ID, api, issued.Scope)
	if err != nil {
		return nil, serverFault(ctx, err)
	}
	resp := op.NewResponse(tokenResponse{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(expires.Sub(s.now()).Round(time.Second) / time.Second),
		RefreshToken: refreshToken,
		Scope:        strings.Join(issued.Scope, " "),
	})
	// RFC 6749 §5.1.
	resp.Header.Set("Cache-Control", "no-store")
	resp.Header.Set("Pragma", "no-cache")
	return resp, nil
}

// opClient is a client as zitadel/oidc reads one: native and public, with
// its grant types, which the library holds a token request to. This package
// checks redirect URIs and scopes itself, so the rest answers nothing.
type opClient struct{ client Client }

// clientOf is the client VerifyClient found.
func clientOf(c op.Client) Client { return c.(opClient).client }

func (c opClient) GetID() string                     { return c.client.ID }
func (c opClient) RedirectURIs() []string            { return c.client.RedirectURIs }
func (opClient) PostLogoutRedirectURIs() []string    { return nil }
func (opClient) ApplicationType() op.ApplicationType { return op.ApplicationTypeNative }
func (opClient) AuthMethod() oidc.AuthMethod         { return oidc.AuthMethodNone }
func (opClient) ResponseTypes() []oidc.ResponseType {
	return []oidc.ResponseType{oidc.ResponseTypeCode}
}
func (c opClient) GrantTypes() []oidc.GrantType {
	grants := make([]oidc.GrantType, len(c.client.GrantTypes))
	for i, grant := range c.client.GrantTypes {
		grants[i] = oidc.GrantType(grant)
	}
	return grants
}
func (opClient) LoginURL(string) string                                   { return "" }
func (opClient) AccessTokenType() op.AccessTokenType                      { return op.AccessTokenTypeJWT }
func (opClient) IDTokenLifetime() time.Duration                           { return 0 }
func (opClient) DevMode() bool                                            { return false }
func (opClient) RestrictAdditionalIdTokenScopes() func([]string) []string { return keepScopes }
func (opClient) RestrictAdditionalAccessTokenScopes() func([]string) []string {
	return keepScopes
}
func (opClient) IsScopeAllowed(string) bool           { return false }
func (opClient) IDTokenUserinfoClaimsAssertion() bool { return false }
func (opClient) ClockSkew() time.Duration             { return 0 }

func keepScopes(scopes []string) []string { return scopes }

// register serves POST /oauth/{project}/register (RFC 7591): a client
// registers at the project, as a public client, and joins the app whose API
// its first authorization request names. The registration store keeps it
// while a consent names it, and purges it an hour after registering
// otherwise.
func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var meta clientMetadata
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxFormSize))
	if err := dec.Decode(&meta); err != nil {
		writeError(w, http.StatusBadRequest, errInvalidClientMetadata, "The body is not client metadata.")
		return
	}
	if meta.ClientID != "" {
		writeError(w, http.StatusBadRequest, errInvalidClientMetadata, "The server assigns client_id.")
		return
	}
	if err := meta.validate(); err != nil {
		code := errInvalidClientMetadata
		if strings.HasPrefix(err.Error(), "redirect_uri") || strings.HasPrefix(err.Error(), "redirect_uris") {
			code = errInvalidRedirectURI
		}
		writeError(w, http.StatusBadRequest, code, err.Error())
		return
	}
	grants := make([]domain.GrantType, len(meta.GrantTypes))
	for i, grant := range meta.GrantTypes {
		grants[i] = domain.GrantType(grant)
	}
	out, err := s.registrations.Register(ctx, service.RegisterClientInput{
		ProjectID: s.projectID,
		Metadata: domain.ClientRegistrationMetadata{
			ClientName:      meta.ClientName,
			ClientURI:       meta.ClientURI,
			LogoURI:         meta.LogoURI,
			SoftwareID:      meta.SoftwareID,
			SoftwareVersion: meta.SoftwareVersion,
			RedirectURIs:    meta.RedirectURIs,
			GrantTypes:      grants,
			AuthMethod:      domain.ClientAuthNone,
		},
	})
	if err != nil {
		var refused domain.Error
		if errors.Is(err, domain.ErrClientRegistrationInvalid(nil)) && errors.As(err, &refused) {
			code, description := registrationRefusal(refused)
			writeError(w, http.StatusBadRequest, code, description)
			return
		}
		writeServerFault(w, r, err)
		return
	}
	registration := out.Registration
	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  registration.ID,
		"client_id_issued_at":        registration.CreatedAt.Unix(),
		"client_name":                registration.Metadata.ClientName,
		"redirect_uris":              registration.Metadata.RedirectURIs,
		"grant_types":                registration.Metadata.GrantTypes,
		"response_types":             meta.ResponseTypes,
		"token_endpoint_auth_method": registration.Metadata.AuthMethod,
	})
}

// registrationRefusal is the RFC 7591 §3.2.2 error for the rules the
// registration store refused, by the path of the first one.
func registrationRefusal(refused domain.Error) (code, description string) {
	code, description = errInvalidClientMetadata, "The client metadata is not valid."
	details, _ := refused.Details.(map[string]any)
	violations, _ := details["violations"].([]domain.AppViolation)
	if len(violations) == 0 {
		return code, description
	}
	first := violations[0]
	if strings.HasPrefix(first.Path, "/redirect_uris") {
		code = errInvalidRedirectURI
	}
	return code, fmt.Sprintf("%s: %s", strings.TrimPrefix(first.Path, "/"), first.Message)
}

// selfOf is the user a token names, as the user service reads its own user.
func (s *Server) selfOf(userID string) domain.Self {
	self, _ := domain.SelfFromAccessToken(s.projectID, userID, s.now().Add(time.Minute), s.now())
	return self
}
