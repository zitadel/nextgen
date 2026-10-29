package oauth

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// refreshPayload is what a refresh token seals. Its record, TokenID, is what
// rotation consumes.
type refreshPayload struct {
	GrantID  string   `json:"grant_id"`
	TokenID  string   `json:"token_id"`
	ClientID string   `json:"client_id"`
	Resource string   `json:"resource"`
	Scope    []string `json:"scope,omitempty"`
	UserID   string   `json:"user_id"`
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

// token serves POST /oauth/{project}/token: the code exchange and refresh.
// Public clients only, so client_id is in the body and PKCE proves it.
func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxFormSize)
	if err := r.ParseForm(); err != nil {
		writeError(w, http.StatusBadRequest, errInvalidRequest, "The request body is not a form.")
		return
	}
	if r.Header.Get("Authorization") != "" {
		writeError(w, http.StatusUnauthorized, errInvalidClient, "Clients here are public: send client_id, not credentials.")
		return
	}
	form := r.PostForm
	for _, single := range []string{"grant_type", "client_id", "code", "code_verifier", "redirect_uri", "refresh_token"} {
		if len(form[single]) > 1 {
			writeError(w, http.StatusBadRequest, errInvalidRequest, single+" is repeated.")
			return
		}
	}
	if len(form["resource"]) > 1 {
		writeError(w, http.StatusBadRequest, errInvalidTarget, "A token is for one API: name one resource.")
		return
	}
	switch form.Get("grant_type") {
	case "authorization_code":
		s.exchangeCode(w, r)
	case "refresh_token":
		s.refresh(w, r)
	default:
		writeError(w, http.StatusBadRequest, errUnsupportedGrantType, "Use authorization_code or refresh_token.")
	}
}

func (s *Server) exchangeCode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	form := r.PostForm
	var code codePayload
	if err := s.unseal(ctx, kindCode, form.Get("code"), &code); err != nil {
		if errors.Is(err, errSealed) {
			writeError(w, http.StatusBadRequest, errInvalidGrant, "The code is not valid or expired.")
			return
		}
		writeServerFault(w, r, err)
		return
	}
	// RFC 6749 §4.1.3: the code is bound to the client and the redirect URI
	// it was issued for, and PKCE to the request that started it.
	switch {
	case form.Get("client_id") != code.ClientID:
		writeError(w, http.StatusBadRequest, errInvalidGrant, "The code was issued to another client.")
		return
	case form.Get("redirect_uri") != code.RedirectURI:
		writeError(w, http.StatusBadRequest, errInvalidGrant, "redirect_uri does not match the authorization request.")
		return
	case verifyPKCE(code.CodeChallenge, form.Get("code_verifier")) != nil:
		writeError(w, http.StatusBadRequest, errInvalidGrant, "code_verifier does not match the code_challenge.")
		return
	case form.Get("resource") != "" && form.Get("resource") != code.Resource:
		writeError(w, http.StatusBadRequest, errInvalidTarget, "The code was issued for another resource.")
		return
	}
	client, err := s.resolveClient(ctx, code.ClientID)
	if err != nil {
		if errors.Is(err, errUnknownClient) {
			writeError(w, http.StatusUnauthorized, errInvalidClient, "The client is not known.")
			return
		}
		writeServerFault(w, r, err)
		return
	}
	if err := s.grants.Redeem(ctx, s.projectID, code.TokenID); err != nil {
		if errors.Is(err, service.ErrOAuthGrantTokenSpent) {
			// A code presented twice may have leaked: whatever it issued goes
			// too (RFC 6749 §4.1.2).
			if err := s.grants.Revoke(ctx, s.projectID, code.GrantID); err != nil {
				writeServerFault(w, r, err)
				return
			}
			writeError(w, http.StatusBadRequest, errInvalidGrant, "The code was already used.")
			return
		}
		writeServerFault(w, r, err)
		return
	}
	s.issueTokens(w, r, client, refreshPayload{
		GrantID:  code.GrantID,
		ClientID: code.ClientID,
		Resource: code.Resource,
		Scope:    code.Scope,
		UserID:   code.UserID,
	}, "")
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	form := r.PostForm
	var grant refreshPayload
	if err := s.unseal(ctx, kindRefresh, form.Get("refresh_token"), &grant); err != nil {
		if errors.Is(err, errSealed) {
			writeError(w, http.StatusBadRequest, errInvalidGrant, "The refresh token is not valid or expired.")
			return
		}
		writeServerFault(w, r, err)
		return
	}
	switch {
	case form.Get("client_id") != grant.ClientID:
		writeError(w, http.StatusBadRequest, errInvalidGrant, "The refresh token was issued to another client.")
		return
	case form.Get("resource") != "" && form.Get("resource") != grant.Resource:
		writeError(w, http.StatusBadRequest, errInvalidTarget, "The refresh token was issued for another resource.")
		return
	}
	// A refresh may narrow the scope, never widen it (RFC 6749 §6).
	if requested := strings.Fields(form.Get("scope")); len(requested) > 0 {
		for _, scope := range requested {
			if !slices.Contains(grant.Scope, scope) {
				writeError(w, http.StatusBadRequest, "invalid_scope", "A refresh cannot add the scope "+scope+".")
				return
			}
		}
		grant.Scope = requested
	}
	client, err := s.resolveClient(ctx, grant.ClientID)
	if err != nil {
		if errors.Is(err, errUnknownClient) {
			writeError(w, http.StatusUnauthorized, errInvalidClient, "The client is not known.")
			return
		}
		writeServerFault(w, r, err)
		return
	}
	s.issueTokens(w, r, client, grant, grant.TokenID)
}

// issueTokens mints the access token for the grant's API and, for a
// first-party client or a third party that was granted offline_access, the
// next refresh token: written fresh after a code, rotated from rotateFrom
// after a refresh.
func (s *Server) issueTokens(w http.ResponseWriter, r *http.Request, client Client, grant refreshPayload, rotateFrom string) {
	ctx := r.Context()
	api, ok := s.app.apiByIdentifier(grant.Resource)
	if !ok {
		// The API left the app since the grant began: the grant cannot widen
		// to another (ADR 081 §10).
		writeError(w, http.StatusBadRequest, errInvalidTarget, "The resource is no longer served.")
		return
	}
	// A user gone from the project ends the grant at its next use.
	if _, err := s.users.GetMyUser(ctx, service.GetMyUserInput{Self: s.selfOf(grant.UserID)}); err != nil {
		if errors.Is(err, domain.ErrUserNotFound()) {
			if err := s.grants.Revoke(ctx, s.projectID, grant.GrantID); err != nil {
				writeServerFault(w, r, err)
				return
			}
			writeError(w, http.StatusBadRequest, errInvalidGrant, "The user no longer exists.")
			return
		}
		writeServerFault(w, r, err)
		return
	}
	issueRefresh := client.FirstParty || slices.Contains(grant.Scope, "offline_access")
	var refreshToken string
	if issueRefresh {
		next := service.OAuthGrantToken{
			ProjectID: s.projectID,
			GrantID:   grant.GrantID,
			UserID:    grant.UserID,
			Scope:     grant.Scope,
			ExpiresAt: s.now().Add(s.cfg.RefreshTokenTTL),
		}
		var (
			tokenID string
			err     error
		)
		if rotateFrom == "" {
			tokenID, err = s.grants.Issue(ctx, next)
		} else {
			tokenID, err = s.grants.Rotate(ctx, s.projectID, rotateFrom, next)
		}
		if err != nil {
			if errors.Is(err, service.ErrOAuthGrantTokenSpent) {
				writeError(w, http.StatusBadRequest, errInvalidGrant, "The refresh token was already used; the grant is revoked.")
				return
			}
			writeServerFault(w, r, err)
			return
		}
		grant.TokenID = tokenID
		refreshToken, err = s.seal(ctx, kindRefresh, grant, s.cfg.RefreshTokenTTL)
		if err != nil {
			writeServerFault(w, r, err)
			return
		}
	} else if rotateFrom != "" {
		// A third party without offline_access never got a refresh token.
		writeError(w, http.StatusBadRequest, errInvalidGrant, "The refresh token is not valid.")
		return
	}
	access, expires, err := s.mintAccessToken(ctx, grant.UserID, client.ID, api, grant.Scope)
	if err != nil {
		writeServerFault(w, r, err)
		return
	}
	w.Header().Set("Pragma", "no-cache")
	writeJSON(w, http.StatusOK, tokenResponse{
		AccessToken:  access,
		TokenType:    "Bearer",
		ExpiresIn:    int64(expires.Sub(s.now()).Round(time.Second) / time.Second),
		RefreshToken: refreshToken,
		Scope:        strings.Join(grant.Scope, " "),
	})
}

// revoke serves POST /oauth/{project}/revoke (RFC 7009). A refresh token
// ends its grant. An access token cannot be revoked: nothing stores it, and
// it expires in minutes (ADR 037). Either way the answer is 200, so a caller
// learns nothing about a token it sends.
func (s *Server) revoke(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, maxFormSize)
	if err := r.ParseForm(); err != nil {
		writeError(w, http.StatusBadRequest, errInvalidRequest, "The request body is not a form.")
		return
	}
	var grant refreshPayload
	if err := s.unseal(ctx, kindRefresh, r.PostForm.Get("token"), &grant); err != nil {
		if !errors.Is(err, errSealed) {
			writeServerFault(w, r, err)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	// RFC 7009 §2.1: a client revokes only its own tokens.
	if r.PostForm.Get("client_id") == grant.ClientID {
		if err := s.grants.Revoke(ctx, s.projectID, grant.GrantID); err != nil {
			writeServerFault(w, r, err)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}

// register serves POST /oauth/{project}/register (RFC 7591): a client joins
// the app as a third party. Nothing is stored; the client_id seals the
// registration.
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
	issued := s.now().Unix()
	clientID, err := s.seal(ctx, kindClient, registration{
		ClientName:   meta.ClientName,
		RedirectURIs: meta.RedirectURIs,
		IssuedAt:     issued,
	}, 0)
	if err != nil {
		writeServerFault(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  clientID,
		"client_id_issued_at":        issued,
		"client_name":                meta.ClientName,
		"redirect_uris":              meta.RedirectURIs,
		"grant_types":                meta.GrantTypes,
		"response_types":             meta.ResponseTypes,
		"token_endpoint_auth_method": meta.TokenEndpointAuthMethod,
	})
}

// selfOf is the user a grant names, as the user service reads its own user.
func (s *Server) selfOf(userID string) domain.Self {
	self, _ := domain.SelfFromAccessToken(s.projectID, userID, s.now().Add(time.Minute), s.now())
	return self
}
