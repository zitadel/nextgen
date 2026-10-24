package cell

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type IssueTokenRequest struct {
	ProjectID string `json:"project_id"`
	Sub       string `json:"sub"`
	Aud       string `json:"aud"`
	Epoch     *int   `json:"epoch,omitempty"`
}

type IssueTokenResponse struct {
	Token  string      `json:"token"`
	Claims TokenClaims `json:"claims"`
}

type PrincipalCheckRequest struct {
	ProjectID string `json:"project_id"`
	Sub       string `json:"sub"`
	Epoch     *int   `json:"epoch,omitempty"`
}

type PrincipalCheckResponse struct {
	Active    bool   `json:"active"`
	Blocked   bool   `json:"blocked"`
	Epoch     int    `json:"epoch"`
	Sub       string `json:"sub"`
	ProjectID string `json:"project_id"`
}

type AuthCheckRequest struct {
	Token     string `json:"token"`
	ProjectID string `json:"project_id"`
	Object    string `json:"object"`
	Relation  string `json:"relation"`
	Online    bool   `json:"online"`
}

type AuthCheckResponse struct {
	Allowed bool           `json:"allowed"`
	Reason  string         `json:"reason"`
	Claims  *TokenClaims   `json:"claims,omitempty"`
	Trace   []TraceHop     `json:"trace,omitempty"`
	Grant   *TupleView     `json:"grant,omitempty"`
	Online  *PrincipalView `json:"online,omitempty"`
}

type PrincipalView struct {
	Active  bool `json:"active"`
	Blocked bool `json:"blocked"`
	Epoch   int  `json:"epoch"`
}

type jwksCacheEntry struct {
	jwks      JWKS
	fetchedAt time.Time
}

func (s *Server) registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/jwks", s.handleJWKS)
	mux.HandleFunc("POST /v1/token/issue", s.handleIssueToken)
	mux.HandleFunc("POST /v1/principal/check", s.handlePrincipalCheck)
	mux.HandleFunc("POST /v1/auth/check", s.handleAuthCheck)
}

func (s *Server) handleJWKS(w http.ResponseWriter, _ *http.Request) {
	key, err := s.signingKey()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, PublicJWKS(key))
}

func (s *Server) handleIssueToken(w http.ResponseWriter, r *http.Request) {
	var req IssueTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	projectID := strings.TrimSpace(req.ProjectID)
	sub := NormalizeKey(req.Sub)
	aud := strings.TrimSpace(req.Aud)
	if projectID == "" || sub == "" || aud == "" {
		writeErr(w, http.StatusBadRequest, "project_id_sub_aud_required")
		return
	}
	if _, err := s.Store.GetProject(projectID); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	user, err := s.Store.GetUser(projectID, sub)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if user.DeletedAt != nil {
		writeErr(w, http.StatusConflict, ErrUserDeleted.Error())
		return
	}
	if user.Blocked {
		writeErr(w, http.StatusForbidden, ErrUserBlocked.Error())
		return
	}
	epoch := user.Epoch
	if epoch <= 0 {
		epoch = DefaultUserEpoch
	}
	if req.Epoch != nil {
		epoch = *req.Epoch
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	key, err := s.signingKey()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := s.Now()
	claims := TokenClaims{
		Sub:         sub,
		HomeCell:    meta.URL,
		HomeProject: projectID,
		Aud:         aud,
		Epoch:       epoch,
		Exp:         now.Add(TokenTTL).Unix(),
		Iss:         meta.URL,
		Iat:         now.Unix(),
	}
	token, err := SignToken(key, claims)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, IssueTokenResponse{Token: token, Claims: claims})
}

func (s *Server) handlePrincipalCheck(w http.ResponseWriter, r *http.Request) {
	var req PrincipalCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	projectID := strings.TrimSpace(req.ProjectID)
	sub := NormalizeKey(req.Sub)
	if projectID == "" || sub == "" {
		writeErr(w, http.StatusBadRequest, "project_id_sub_required")
		return
	}
	user, err := s.Store.GetUser(projectID, sub)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			writeJSON(w, http.StatusOK, PrincipalCheckResponse{
				Active: false, Blocked: false, Epoch: 0, Sub: sub, ProjectID: projectID,
			})
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	epoch := user.Epoch
	if epoch <= 0 {
		epoch = DefaultUserEpoch
	}
	active := user.IsActive()
	writeJSON(w, http.StatusOK, PrincipalCheckResponse{
		Active: active, Blocked: user.Blocked || user.DeletedAt != nil, Epoch: epoch, Sub: sub, ProjectID: projectID,
	})
}

func (s *Server) handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	var req AuthCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	token := strings.TrimSpace(req.Token)
	projectID := strings.TrimSpace(req.ProjectID)
	object := strings.TrimSpace(req.Object)
	relation := strings.TrimSpace(req.Relation)
	if token == "" || projectID == "" || object == "" || relation == "" {
		writeErr(w, http.StatusBadRequest, "token_project_object_relation_required")
		return
	}
	if _, err := s.Store.GetProject(projectID); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	var trace []TraceHop
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	unverified, err := DecodeTokenClaims(token)
	if err != nil {
		writeJSON(w, http.StatusOK, AuthCheckResponse{Allowed: false, Reason: ErrInvalidToken.Error(), Trace: trace})
		return
	}
	homeURL := NormalizeURL(unverified.Iss)
	if homeURL == "" {
		homeURL = NormalizeURL(unverified.HomeCell)
	}
	if homeURL == "" {
		writeJSON(w, http.StatusOK, AuthCheckResponse{
			Allowed: false, Reason: "missing_issuer", Claims: &unverified, Trace: trace,
		})
		return
	}

	start := time.Now()
	jwks, err := s.fetchJWKS(r.Context(), homeURL)
	trace = append(trace, TraceHop{
		Cell: homeURL, Method: "GET /v1/jwks",
		Ms: time.Since(start).Milliseconds(),
		Result: func() string {
			if err != nil {
				return "error: " + err.Error()
			}
			return "ok"
		}(),
	})
	if err != nil {
		writeJSON(w, http.StatusOK, AuthCheckResponse{
			Allowed: false, Reason: "jwks_fetch_failed", Claims: &unverified, Trace: trace,
		})
		return
	}
	jwk, ok := FindJWK(jwks, TokenKid(token))
	if !ok {
		writeJSON(w, http.StatusOK, AuthCheckResponse{
			Allowed: false, Reason: "jwks_key_not_found", Claims: &unverified, Trace: trace,
		})
		return
	}
	pub, err := PublicKeyFromJWK(jwk)
	if err != nil {
		writeJSON(w, http.StatusOK, AuthCheckResponse{
			Allowed: false, Reason: "jwks_key_invalid", Claims: &unverified, Trace: trace,
		})
		return
	}
	claims, err := VerifyToken(token, pub, s.Now())
	if err != nil {
		writeJSON(w, http.StatusOK, AuthCheckResponse{
			Allowed: false, Reason: err.Error(), Claims: &unverified, Trace: trace,
		})
		return
	}
	if claims.Aud != "" && claims.Aud != object && claims.Aud != projectID {
		// Allow aud to be the app object (e.g. app:chat) or the resource project id.
		writeJSON(w, http.StatusOK, AuthCheckResponse{
			Allowed: false, Reason: ErrTokenAudience.Error(), Claims: &claims, Trace: trace,
		})
		return
	}

	var onlineView *PrincipalView
	if req.Online {
		// Local denylist from user.blocked fan-out (optional fail-fast before home RPC).
		if s.denylist.IsBlocked(projectID, claims.Sub, s.Now()) {
			trace = append(trace, TraceHop{
				Cell: meta.URL, Method: "local denylist", Result: "blocked",
			})
			onlineView = &PrincipalView{Active: false, Blocked: true, Epoch: claims.Epoch}
			writeJSON(w, http.StatusOK, AuthCheckResponse{
				Allowed: false, Reason: ErrPrincipalInactive.Error(), Claims: &claims, Trace: trace, Online: onlineView,
			})
			return
		}
		hopStart := time.Now()
		checkHome := NormalizeURL(claims.HomeCell)
		if checkHome == "" {
			checkHome = homeURL
		}
		epoch := claims.Epoch
		pr, err := s.Peer.PrincipalCheck(r.Context(), checkHome, PrincipalCheckRequest{
			ProjectID: claims.HomeProject,
			Sub:       claims.Sub,
			Epoch:     &epoch,
		})
		hop := TraceHop{
			Cell: checkHome, Method: "POST /v1/principal/check",
			Ms: time.Since(hopStart).Milliseconds(),
		}
		if err != nil {
			// Fail-closed when home is unreachable during online check.
			hop.Result = "error: " + err.Error()
			trace = append(trace, hop)
			writeJSON(w, http.StatusOK, AuthCheckResponse{
				Allowed: false, Reason: "principal_check_failed", Claims: &claims, Trace: trace,
			})
			return
		}
		onlineView = &PrincipalView{Active: pr.Active, Blocked: pr.Blocked, Epoch: pr.Epoch}
		hop.Result = "active"
		if !pr.Active || pr.Blocked {
			hop.Result = "inactive_or_blocked"
			trace = append(trace, hop)
			writeJSON(w, http.StatusOK, AuthCheckResponse{
				Allowed: false, Reason: ErrPrincipalInactive.Error(), Claims: &claims, Trace: trace, Online: onlineView,
			})
			return
		}
		if pr.Epoch != claims.Epoch {
			hop.Result = "epoch_mismatch"
			trace = append(trace, hop)
			writeJSON(w, http.StatusOK, AuthCheckResponse{
				Allowed: false, Reason: ErrEpochMismatch.Error(), Claims: &claims, Trace: trace, Online: onlineView,
			})
			return
		}
		trace = append(trace, hop)
	}

	grantStart := time.Now()
	grant, found, err := s.Store.FindGrant(projectID, object, relation, claims.Sub, claims.HomeProject, claims.HomeCell)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	trace = append(trace, TraceHop{
		Cell: meta.URL, Method: "local grant check",
		Ms: time.Since(grantStart).Milliseconds(),
		Result: func() string {
			if found {
				return "allowed@" + grant.ID
			}
			return "denied"
		}(),
	})
	if !found {
		writeJSON(w, http.StatusOK, AuthCheckResponse{
			Allowed: false, Reason: ErrGrantDenied.Error(), Claims: &claims, Trace: trace, Online: onlineView,
		})
		return
	}
	tv := tupleView(grant)
	writeJSON(w, http.StatusOK, AuthCheckResponse{
		Allowed: true, Reason: "ok", Claims: &claims, Trace: trace, Grant: &tv, Online: onlineView,
	})
}

func (s *Server) signingKey() (SigningKey, error) {
	s.signerMu.Lock()
	defer s.signerMu.Unlock()
	if s.signer != nil {
		return *s.signer, nil
	}
	key, err := s.Store.GetOrCreateSigningKey()
	if err != nil {
		return SigningKey{}, err
	}
	s.signer = &key
	return key, nil
}

func (s *Server) fetchJWKS(ctx context.Context, homeURL string) (JWKS, error) {
	homeURL = NormalizeURL(homeURL)
	s.jwksMu.Lock()
	if ent, ok := s.jwksCache[homeURL]; ok && s.Now().Sub(ent.fetchedAt) < JWKSCacheTTL {
		jwks := ent.jwks
		s.jwksMu.Unlock()
		return jwks, nil
	}
	s.jwksMu.Unlock()

	jwks, err := s.Peer.GetJWKS(ctx, homeURL)
	if err != nil {
		return JWKS{}, err
	}
	s.jwksMu.Lock()
	if s.jwksCache == nil {
		s.jwksCache = map[string]jwksCacheEntry{}
	}
	s.jwksCache[homeURL] = jwksCacheEntry{jwks: jwks, fetchedAt: s.Now()}
	s.jwksMu.Unlock()
	return jwks, nil
}
