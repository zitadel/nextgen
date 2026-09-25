package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// CSRFHeader carries the session-bound CSRF token on cookie-authenticated
// management writes (ADR 053 §5).
const CSRFHeader = "X-Zitadel-CSRF"

// csrfOriginGuard rejects unsafe cross-origin browser requests: it reads the
// browser-set Sec-Fetch-Site header, falling back to comparing Origin with
// Host. Requests carrying neither are non-browser clients and pass; those
// still need the token where one is required.
var csrfOriginGuard = http.NewCrossOriginProtection()

// csrfProtectedOperations need the X-Zitadel-CSRF token when the session
// cookie authenticates them: the state-changing management operations plus
// claim/complete (ADR 053 §5) and the user's own profile write. Logout
// (revokeMySession) gets the origin check only — customer apps call it
// through the SDK proxies, which cannot supply the token yet — and the
// POST query operations are reads, which may omit it.
var csrfProtectedOperations = map[api.OperationName]bool{
	api.CreateUserOperation:     true,
	api.DeleteUserByIDOperation: true,
	api.CreateTeamOperation:     true,
	api.UpdateTeamOperation:     true,
	api.PatchProjectOperation:   true,
	api.CreateGrantOperation:    true,
	api.DeleteGrantOperation:    true,
	api.CompleteClaimOperation:  true,
	api.PatchMyUserOperation:    true,
}

type csrfRequestKey struct{}

// csrfRequest is what the security handler needs from the HTTP request, which
// ogen does not hand it.
type csrfRequest struct {
	unsafe    bool
	originErr error
	token     string
}

// WithCSRFRequest records the request's method, cross-origin verdict and
// CSRF header for HandleNextgenSession. It rejects nothing itself: whether a
// check applies depends on the operation and on the credential that
// authenticated it, which only the security handler knows.
func WithCSRFRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		req := csrfRequest{token: r.Header.Get(CSRFHeader)}
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			req.unsafe = true
			req.originErr = csrfOriginGuard.Check(r)
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), csrfRequestKey{}, req)))
	})
}

// CSRFToken derives the CSRF token for a session cookie value: an HMAC-SHA256
// keyed by the cookie over a fixed label. Only a holder of the HttpOnly
// cookie can compute or learn it — from GET /sessions/me/csrf, which a cross-site
// page cannot read — so it binds the header to the session without
// server-side state or keys.
func CSRFToken(sessionCookie string) string {
	mac := hmac.New(sha256.New, []byte(sessionCookie))
	mac.Write([]byte("zitadel-csrf-v1"))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// checkSessionCSRF enforces ADR 053 §5 on a request the session cookie
// authenticates. Safe methods always pass; unsafe ones must be same-origin,
// and protected operations must also carry the session's token.
func checkSessionCSRF(ctx context.Context, operationName api.OperationName, sessionCookie string) error {
	req, ok := ctx.Value(csrfRequestKey{}).(csrfRequest)
	if !ok || !req.unsafe {
		return nil
	}
	if req.originErr != nil {
		return domain.ErrAuthCSRFInvalid()
	}
	if !csrfProtectedOperations[operationName] {
		return nil
	}
	want := CSRFToken(sessionCookie)
	if subtle.ConstantTimeCompare([]byte(req.token), []byte(want)) != 1 {
		return domain.ErrAuthCSRFInvalid()
	}
	return nil
}
