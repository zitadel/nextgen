package oauth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errorpage"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// OAuth error codes (RFC 6749 §4.1.2.1 and §5.2, RFC 8707 §2, RFC 7591 §3.2.2).
const (
	errInvalidRequest          = "invalid_request"
	errInvalidClient           = "invalid_client"
	errInvalidGrant            = "invalid_grant"
	errUnsupportedGrantType    = "unsupported_grant_type"
	errUnsupportedResponseType = "unsupported_response_type"
	errInvalidTarget           = "invalid_target"
	errAccessDenied            = "access_denied"
	errLoginRequired           = "login_required"
	errConsentRequired         = "consent_required"
	errServerError             = "server_error"
	errInvalidRedirectURI      = "invalid_redirect_uri"
	errInvalidClientMetadata   = "invalid_client_metadata"
)

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeError answers a back-channel endpoint (token, revoke, register) with
// RFC 6749 §5.2's error body.
func writeError(w http.ResponseWriter, status int, code, description string) {
	writeJSON(w, status, map[string]string{"error": code, "error_description": description})
}

// writeServerFault answers an error that is the server's, not the client's,
// keeping a classified failure's status (503 for an unavailable store) so
// clients retry rather than drop their tokens.
func writeServerFault(w http.ResponseWriter, r *http.Request, err error) {
	status := http.StatusInternalServerError
	if e, ok := errors.AsType[domain.Error](err); ok && errors.Is(e, domain.ErrUnavailable()) {
		status = http.StatusServiceUnavailable
	}
	zlog.Error(r.Context(), "oauth: server fault", slog.Any("error", err))
	writeError(w, status, errServerError, "The server could not complete the request.")
}

// redirectError sends the browser back to a validated redirect URI with an
// error, the state and the issuer (RFC 9207).
func (s *Server) redirectError(w http.ResponseWriter, r *http.Request, redirectURI *url.URL, state, code, description string) {
	target := *redirectURI
	q := target.Query()
	q.Set("error", code)
	if description != "" {
		q.Set("error_description", description)
	}
	if state != "" {
		q.Set("state", state)
	}
	q.Set("iss", s.issuer)
	target.RawQuery = q.Encode()
	http.Redirect(w, r, target.String(), http.StatusSeeOther)
}

// invalidAuthorizationRequest is the page for a request that cannot be sent
// back to its client: its client or redirect URI did not check out, so it
// redirects nowhere (ADR 081 §8).
func invalidAuthorizationRequest(w http.ResponseWriter, r *http.Request) {
	errorpage.Write(w, r, errorpage.Page{
		Status:      http.StatusBadRequest,
		Title:       "This sign-in link is not valid",
		Description: "The app that sent you here asked to sign in in a way this server does not accept. Go back to the app and start again.",
	})
}

func authorizationServerFault(w http.ResponseWriter, r *http.Request, err error) {
	zlog.Error(r.Context(), "oauth: server fault", slog.Any("error", err))
	errorpage.Write(w, r, errorpage.Page{
		Status:      http.StatusInternalServerError,
		Title:       "Something went wrong",
		Description: "The server could not complete the sign-in. Try again in a moment.",
	})
}
