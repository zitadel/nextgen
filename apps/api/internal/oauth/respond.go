package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

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

// writeServerFault answers an error that is the server's, not the client's.
func writeServerFault(w http.ResponseWriter, r *http.Request, err error) {
	zlog.Error(r.Context(), "oauth: server fault", slog.Any("error", err))
	writeError(w, faultStatus(err), errServerError, faultDescription)
}

// serverFault is writeServerFault for the endpoints op.Server answers.
func serverFault(ctx context.Context, err error) error {
	zlog.Error(ctx, "oauth: server fault", slog.Any("error", err))
	return op.NewStatusError(oidc.ErrServerError().WithDescription(faultDescription), faultStatus(err))
}

const faultDescription = "The server could not complete the request."

// faultStatus keeps a classified failure's status (503 for an unavailable
// store), so clients retry rather than drop their tokens.
func faultStatus(err error) int {
	if e, ok := errors.AsType[domain.Error](err); ok && errors.Is(e, domain.ErrUnavailable()) {
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}

// invalidClient fails a client's authentication with 401 (RFC 6749 §5.2).
func invalidClient(description string) error {
	return op.NewStatusError(oidc.ErrInvalidClient().WithDescription("%s", description), http.StatusUnauthorized)
}

// redirectError sends the browser back to a validated redirect URI with an
// error, the state and the issuer (RFC 9207).
func (s *Server) redirectError(w http.ResponseWriter, r *http.Request, redirectURI *url.URL, state, code, description string) {
	http.Redirect(w, r, s.errorRedirectURL(redirectURI, state, code, description), http.StatusSeeOther)
}

// errorRedirectURL is a validated redirect URI with an error, the state and
// the issuer (RFC 9207).
func (s *Server) errorRedirectURL(redirectURI *url.URL, state, code, description string) string {
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
	return target.String()
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
