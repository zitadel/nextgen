package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

// newErrorHandlerTestServer builds the generated server around a zero-value
// Handler. Every request in these tests fails before reaching a handler
// method (security check or parameter decode), so no services are needed.
func newErrorHandlerTestServer(t *testing.T, tokenService service.TokenService) *api.Server {
	t.Helper()
	srv, err := api.NewServer(&Handler{}, NewSecurityHandler(tokenService), api.WithErrorHandler(OgenErrorHandler))
	require.NoError(t, err)
	return srv
}

func TestOgenErrorHandlerMissingSessionCookie(t *testing.T) {
	t.Parallel()
	// The security handler is never invoked when the cookie is absent, so no
	// verifier is needed.
	srv := newErrorHandlerTestServer(t, nil)

	tests := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/sessions/me"},
		{http.MethodDelete, "/sessions/me"},
		{http.MethodGet, "/users/me"},
	}
	for _, tc := range tests {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))

			require.Equal(t, http.StatusUnauthorized, rec.Code)
			// Exact match: proves the stable code and that no internal
			// diagnostics (parent, location) leak into the response.
			require.JSONEq(t,
				`{"code":"auth.unauthorized","message":"Missing or invalid session token."}`,
				rec.Body.String(),
			)
		})
	}
}

func TestOgenErrorHandlerInvalidSessionCookie(t *testing.T) {
	t.Parallel()
	mock := gomock.NewController(t)
	tokenService := mocks.NewMockTokenService(mock)
	tokenService.EXPECT().VerifyToken(gomock.Any(), gomock.Any()).Return(nil, errors.New("bad token"))

	srv := newErrorHandlerTestServer(t, tokenService)

	req := httptest.NewRequest(http.MethodGet, "/sessions/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "garbage"})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.JSONEq(t,
		`{"code":"auth.unauthorized","message":"Missing or invalid session token."}`,
		rec.Body.String(),
	)
}

func TestOgenErrorHandlerNonCredentialCookieDecodeStays400(t *testing.T) {
	t.Parallel()
	srv := newErrorHandlerTestServer(t, nil)

	// The _zflow cookie is flow state, not a session credential: its absence
	// must stay a structural 400, not become a 401.
	req := httptest.NewRequest(http.MethodPost, "/flow/flow_123/submit", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.JSONEq(t,
		`{"code":"req.invalid","message":"The request is invalid and fails base validation (missing required fields, wrong types, failed regex, etc.). Check the details for more information."}`,
		rec.Body.String(),
	)
}

func TestOgenErrorHandlerSecurityErrorNormalizedMessage(t *testing.T) {
	t.Parallel()
	srv := newErrorHandlerTestServer(t, nil)

	// querySessions requires oauth2; without credentials the security check
	// fails before body and parameter decode and before any handler method runs.
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/sessions/query", nil))

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.JSONEq(t,
		`{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`,
		rec.Body.String(),
	)
}

func TestDomainErrorDetailsOmitsDiagnostics(t *testing.T) {
	t.Parallel()

	details := domainErrorDetails(domain.ErrInternal(errors.New("pq: secret driver detail")))

	require.Equal(t, api.ErrorCode("internal"), details.Code)
	require.Equal(t, "An unexpected error occurred.", details.Message)
	require.False(t, details.Details.Set, "parent/location diagnostics must not be serialized")
}
