package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/ogen-go/ogen/validate"
	"github.com/stretchr/testify/require"
	slogctx "github.com/veqryn/slog-context"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errorpage"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog/extractors"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/sloggcp"
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
	tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, domain.ErrInvalidToken())

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
	// must stay a structural 400, not become a 401. The details name the
	// missing parameter.
	req := httptest.NewRequest(http.MethodPost, "/flow/flow_123/submit", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.JSONEq(t,
		`{"code":"req.invalid","message":"The request is invalid and fails base validation (missing required fields, wrong types, failed regex, etc.). Check the details for more information.","details":{"details":{"fields":["_zflow"]}}}`,
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

func TestOgenErrorHandlerGrantSecurityStaysCredentialNeutral(t *testing.T) {
	t.Parallel()

	const want = `{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`
	require.False(t, sessionCookieOperations[api.QueryGrantsOperation])

	t.Run("missing credentials", func(t *testing.T) {
		t.Parallel()
		srv := newErrorHandlerTestServer(t, nil)
		tests := []struct {
			name string
			req  *http.Request
		}{
			{
				name: "create",
				req:  httptest.NewRequest(http.MethodPost, "/grants?project_id=proj_1", strings.NewReader(`{"principal_type":"user","principal_id":"user_1","relation":"viewer"}`)),
			},
			{
				name: "get",
				req:  httptest.NewRequest(http.MethodGet, "/grants/asgn_1?project_id=proj_1", nil),
			},
			{
				name: "delete",
				req:  httptest.NewRequest(http.MethodDelete, "/grants/asgn_1?project_id=proj_1", nil),
			},
			{
				name: "query",
				req:  httptest.NewRequest(http.MethodPost, "/grants/query?project_id=proj_1", strings.NewReader(`{}`)),
			},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				if tc.req.Method == http.MethodPost {
					tc.req.Header.Set("Content-Type", "application/json")
				}
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, tc.req)
				require.Equal(t, http.StatusUnauthorized, rec.Code)
				require.JSONEq(t, want, rec.Body.String())
			})
		}
	})

	t.Run("invalid bearer", func(t *testing.T) {
		t.Parallel()
		tests := []struct {
			name string
			req  *http.Request
		}{
			{
				name: "create",
				req:  httptest.NewRequest(http.MethodPost, "/grants?project_id=proj_1", strings.NewReader(`{"principal_type":"user","principal_id":"user_1","relation":"viewer"}`)),
			},
			{
				name: "query",
				req:  httptest.NewRequest(http.MethodPost, "/grants/query?project_id=proj_1", strings.NewReader(`{}`)),
			},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				mock := gomock.NewController(t)
				tokenService := mocks.NewMockTokenService(mock)
				tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, domain.ErrInvalidToken())
				srv := newErrorHandlerTestServer(t, tokenService)

				tc.req.Header.Set("Content-Type", "application/json")
				tc.req.Header.Set("Authorization", "Bearer garbage")
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, tc.req)

				require.Equal(t, http.StatusUnauthorized, rec.Code)
				require.JSONEq(t, want, rec.Body.String())
			})
		}
	})
}

func TestOgenErrorHandlerQueryUsersSecurityStaysCredentialNeutral(t *testing.T) {
	t.Parallel()

	const want = `{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`
	require.False(t, sessionCookieOperations[api.QueryUsersOperation])

	t.Run("missing credentials", func(t *testing.T) {
		t.Parallel()
		srv := newErrorHandlerTestServer(t, nil)
		req := httptest.NewRequest(http.MethodPost, "/users/query", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		require.Equal(t, http.StatusUnauthorized, rec.Code)
		require.JSONEq(t, want, rec.Body.String())
	})

	t.Run("invalid bearer", func(t *testing.T) {
		t.Parallel()
		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, domain.ErrInvalidToken())
		srv := newErrorHandlerTestServer(t, tokenService)

		req := httptest.NewRequest(http.MethodPost, "/users/query", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer garbage")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnauthorized, rec.Code)
		require.JSONEq(t, want, rec.Body.String())
	})
}

// dualSchemeRequests is one request per operation that accepts either the
// session cookie or a bearer, for the tests pinning that a bad or anonymous
// cookie on them stays a credential-neutral 401.
var dualSchemeRequests = []struct {
	name   string
	method string
	path   string
	body   string
}{
	{"grant create", http.MethodPost, "/grants?project_id=proj_1", `{"principal_type":"user","principal_id":"user_1","relation":"viewer"}`},
	{"grant get", http.MethodGet, "/grants/asgn_1?project_id=proj_1", ""},
	{"grant delete", http.MethodDelete, "/grants/asgn_1?project_id=proj_1", ""},
	{"grant query", http.MethodPost, "/grants/query?project_id=proj_1", `{}`},
	{"users query", http.MethodPost, "/users/query", `{}`},
	{"teams query", http.MethodPost, "/teams/query?project_id=proj_1", `{}`},
	{"team get", http.MethodGet, "/teams/team_1", ""},
	{"user create", http.MethodPost, "/users?project_id=proj_1", `{}`},
	{"user get", http.MethodGet, "/users/user_1", ""},
	{"user passkeys", http.MethodGet, "/users/user_1/passkeys", ""},
	{"user patch", http.MethodPatch, "/users/user_1", `{"attributes":{"nickname":"x"}}`},
	{"user delete", http.MethodDelete, "/users/user_1", ""},
	{"team create", http.MethodPost, "/teams?project_id=proj_1", `{"name":"x"}`},
	{"team update", http.MethodPatch, "/teams/team_1", `{"name":"x"}`},
	{"schemas list", http.MethodGet, "/schemas?project_id=proj_1", ""},
	{"schema get", http.MethodGet, "/schemas/schema_1?project_id=proj_1", ""},
	{"flow definitions list", http.MethodGet, "/flow_definitions?project_id=proj_1", ""},
	{"flow definition get", http.MethodGet, "/flow_definitions/fdef_1?project_id=proj_1", ""},
	{"branding list", http.MethodGet, "/branding?project_id=proj_1", ""},
	{"branding get", http.MethodGet, "/branding/brand_1?project_id=proj_1", ""},
	{"idps query", http.MethodPost, "/idps/query?project_id=proj_1", `{}`},
	{"idp get", http.MethodGet, "/idps/idp_1?project_id=proj_1", ""},
	{"releases list", http.MethodGet, "/releases?project_id=proj_1", ""},
	{"release get", http.MethodGet, "/releases/rel_1?project_id=proj_1", ""},
	{"deployments list", http.MethodGet, "/deployments?project_id=proj_1", ""},
	{"deployment get", http.MethodGet, "/deployments/dep_1?project_id=proj_1", ""},
	{"deployment create", http.MethodPost, "/deployments?project_id=proj_1", `{"release_id":"rel_1","targets":["primary"]}`},
	{"deployment rollback", http.MethodPost, "/deployments/dep_1/rollback?project_id=proj_1", `{}`},
	{"release revoke", http.MethodPost, "/releases/rel_1/revoke?project_id=proj_1", ""},
}

func TestOgenErrorHandlerDualSchemeInvalidCookieStaysCredentialNeutral(t *testing.T) {
	t.Parallel()

	const want = `{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`
	for _, op := range []api.OperationName{
		api.CreateGrantOperation,
		api.GetGrantOperation,
		api.DeleteGrantOperation,
		api.QueryGrantsOperation,
		api.QueryUsersOperation,
		api.QueryTeamsOperation,
		api.GetTeamOperation,
		api.CreateUserOperation,
		api.GetUserByIDOperation,
		api.PatchUserByIDOperation,
		api.DeleteUserByIDOperation,
		api.CreateTeamOperation,
		api.UpdateTeamOperation,
		api.ListSchemasOperation,
		api.GetSchemaByIdOperation,
		api.ListFlowDefinitionsOperation,
		api.GetFlowDefinitionOperation,
		api.ListBrandingOperation,
		api.GetBrandingByIdOperation,
		api.QueryIdpsOperation,
		api.GetIdpByIdOperation,
		api.ListReleasesOperation,
		api.GetReleaseByIdOperation,
		api.ListDeploymentsOperation,
		api.GetDeploymentByIdOperation,
		api.CreateDeploymentOperation,
		api.RollbackDeploymentOperation,
		api.RevokeReleaseOperation,
	} {
		require.False(t, sessionCookieOperations[op], "%s must stay off the session-only 401 rewrite", op)
	}

	for _, tc := range dualSchemeRequests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			mock := gomock.NewController(t)
			tokenService := mocks.NewMockTokenService(mock)
			tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, domain.ErrInvalidToken())
			srv := newErrorHandlerTestServer(t, tokenService)

			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "garbage"})
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)

			require.Equal(t, http.StatusUnauthorized, rec.Code)
			require.JSONEq(t, want, rec.Body.String())
		})
	}
}

func TestOgenErrorHandlerAnonymousSessionOnDualSchemeStays401(t *testing.T) {
	t.Parallel()

	const want = `{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`

	for _, tc := range dualSchemeRequests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			token := &domain.Token{
				ProjectID: "project-1",
				TokenID:   "token-1",
				Type:      domain.TokenTypeSessionToken,
				SessionID: new("session-1"),
			}
			mock := gomock.NewController(t)
			tokenService := mocks.NewMockTokenService(mock)
			tokenService.EXPECT().IntrospectToken(gomock.Any(), "building").Return(token, nil)
			srv := newErrorHandlerTestServer(t, tokenService)

			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "building"})
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)

			require.Equal(t, http.StatusUnauthorized, rec.Code)
			require.JSONEq(t, want, rec.Body.String())
		})
	}
}

func TestDomainErrorDetailsOmitsDiagnostics(t *testing.T) {
	t.Parallel()

	details := domainErrorDetails(domain.ErrInternal(errors.New("pq: secret driver detail")))

	require.Equal(t, api.ErrorCode("internal"), details.Code)
	require.Equal(t, "An unexpected error occurred.", details.Message)
	require.False(t, details.Details.Set, "parent/location diagnostics must not be serialized")
}

// A transaction that exhausted its abort retries is transient, so the caller
// needs a status that says "retry", not the 500 it used to get.
func TestErrorResponseUnavailableIs503(t *testing.T) {
	t.Parallel()

	got := errorResponse(domain.ErrUnavailable().WithParent(errors.New("transaction aborted")))

	require.Equal(t, http.StatusServiceUnavailable, got.StatusCode)
	require.Equal(t, api.ErrorCode("unavailable"), got.Response.Code)
}

func TestErrorResponseInternalStays500(t *testing.T) {
	t.Parallel()

	got := errorResponse(domain.ErrInternal(errors.New("boom")))

	require.Equal(t, http.StatusInternalServerError, got.StatusCode,
		"only transient failures may claim 503")
}

func TestDomainErrorDetails_requestInvalidField(t *testing.T) {
	t.Parallel()

	details := domainErrorDetails(
		domain.ErrRequestInvalid().
			WithMessage(`invalid value for field "age"`).
			WithDetails(domain.RequestInvalidFieldDetails{Field: "age"}),
	)

	require.Equal(t, api.ErrorCode("req.invalid"), details.Code)
	require.Equal(t, `invalid value for field "age"`, details.Message)
	require.True(t, details.Details.Set)
	require.JSONEq(t, `{"field":"age"}`, string(details.Details.Value["details"]))
	_, hasParent := details.Details.Value["parent"]
	require.False(t, hasParent, "parent must stay off when FullErrorInResponse is false")
}

func TestDomainErrorDetails_fullErrorInResponseComposesWithProducerDetails(t *testing.T) {
	// Mutates package-global FullErrorInResponse; must not run parallel with
	// other tests that assume the default (false).
	prev := FullErrorInResponse.Load()
	FullErrorInResponse.Store(true)
	t.Cleanup(func() { FullErrorInResponse.Store(prev) })

	details := domainErrorDetails(
		domain.ErrRequestInvalid().
			WithMessage(`invalid value for field "age"`).
			WithDetails(domain.RequestInvalidFieldDetails{Field: "age"}).
			WithParent(errors.New("json: cannot unmarshal number")),
	)

	require.True(t, details.Details.Set)
	require.JSONEq(t, `{"field":"age"}`, string(details.Details.Value["details"]))
	require.Contains(t, string(details.Details.Value["parent"]), "json: cannot unmarshal number")
}

// validationFieldPaths turns ogen's nested validation failures into the dotted
// paths the decode error names, without any of the leaf error text.
func TestValidationFieldPaths(t *testing.T) {
	t.Parallel()

	nested := &validate.Error{Fields: []validate.FieldError{
		{Name: "idp", Error: &validate.Error{Fields: []validate.FieldError{
			{Name: "slug", Error: errors.New("pattern mismatch")},
			{Name: "oidc", Error: &validate.Error{Fields: []validate.FieldError{
				{Name: "client_secret", Error: errors.New("secret value leaks here")},
			}}},
		}}},
	}}
	wrapped := &ogenerrors.DecodeRequestError{Err: fmt.Errorf("validate: %w", nested)}

	require.Equal(t, []string{"idp.slug", "idp.oidc.client_secret"}, validationFieldPaths(wrapped))
	require.Nil(t, validationFieldPaths(&ogenerrors.DecodeRequestError{Err: errors.New("unexpected end of JSON input")}))
}

// unmappedClientCodes are the codes errorResponse answers with 500 only because
// no mapper lists them, though they are not server faults: they can be caused
// by client input or a caller's mistake. A service span keeps status Unset for
// them. Map such a code to its 4xx when it reaches a handler, then drop it here.
var unmappedClientCodes = map[string]bool{
	"att.sso_state_invalid":       true,
	"auth.csrf_invalid":           true,
	"claim.session_expired":       true,
	"claim.session_not_active":    true,
	"claim.session_wrong_project": true,
	"enc_key.no_replacement_key":  true,
	"enc_key.not_found":           true,
	"idp.endpoint_cleartext":      true,
	"idp.endpoints_partial":       true,
	"idp.protocol_block_missing":  true,
	"idp.scopes_missing_openid":   true,
	"tkn.invalid":                 true,
	"tkn.invalid_tknid":           true,
	"tkn.revoked":                 true,
	"user.password_invalid":       true,
}

// serverFaultStatus is the status each server-fault code is answered with.
// A code missing here is answered with a 500.
var serverFaultStatus = map[string]int{
	domain.ErrNotImplemented().Code: http.StatusNotImplemented,
	domain.ErrUnavailable().Code:    http.StatusServiceUnavailable,
}

// TestErrorResponse_serverFaultsAre5xx keeps the HTTP status and
// domain.IsServerFault, which a service span reads, from drifting apart: every
// code in the generated error catalog that gets a 5xx must be a server fault,
// or be listed in unmappedClientCodes.
func TestErrorResponse_serverFaultsAre5xx(t *testing.T) {
	t.Parallel()

	files, err := filepath.Glob("../../api/openapi/components/schemas/errors/*.yaml")
	require.NoError(t, err)
	require.NotEmpty(t, files, "the generated error catalog is missing")
	constRe := regexp.MustCompile(`(?m)^\s+const: (\S+)$`)
	for _, file := range files {
		raw, err := os.ReadFile(file)
		require.NoError(t, err)
		m := constRe.FindSubmatch(raw)
		require.NotNil(t, m, "no code in %s", file)
		code := string(m[1])

		// The parent carries another server-fault code, so a status read from
		// the parent instead of the body code fails here.
		e := domain.Error{Code: code, Parent: domain.ErrUnavailable()}
		resp := errorResponse(e)
		is5xx := resp.StatusCode >= http.StatusInternalServerError
		switch {
		case domain.IsServerFault(e):
			require.Equal(t, api.ErrorCode(code), resp.Response.Code)
			want, ok := serverFaultStatus[code]
			if !ok {
				want = http.StatusInternalServerError
			}
			require.Equal(t, want, resp.StatusCode, "%s is a server fault answered with the wrong status", code)
		case unmappedClientCodes[code]:
			require.True(t, is5xx, "%s is mapped now: remove it from unmappedClientCodes", code)
		default:
			require.False(t, is5xx, "%s gets a 5xx: add it to the server faults in internal/domain/error.go, or map it to a 4xx", code)
		}
	}
}

// A CSRF refusal is logged as the error the check returned, not a fresh one
// built in the error handler, so its cause and origin stay on the line. The
// body keeps the stable code and message.
func TestOgenErrorHandlerLogsTheCSRFErrorItWasGiven(t *testing.T) {
	records := recordLogs(t)
	err := &ogenerrors.SecurityError{
		Security: "NextgenSession",
		Err:      domain.ErrAuthCSRFInvalid().WithParent(errors.New("origin mismatch")),
	}
	rec := httptest.NewRecorder()
	OgenErrorHandler(t.Context(), rec, httptest.NewRequest(http.MethodPost, "/teams", nil), err)

	require.Equal(t, http.StatusForbidden, rec.Code)
	want := domain.ErrAuthCSRFInvalid()
	require.JSONEq(t, fmt.Sprintf(`{"code":%q,"message":%q}`, want.Code, want.Message), rec.Body.String())
	require.Len(t, records(), 1)
	require.Equal(t, "origin mismatch", records()[0]["error"].(map[string]any)["parent"])
}

// A security handler that cannot reach a decision (the CSRF request state is
// missing because WithCSRFRequest is not wired) is a server fault: 500, not
// the 401 a refused credential gets.
func TestOgenErrorHandlerSecurityInternalErrorIs500(t *testing.T) {
	t.Parallel()
	err := &ogenerrors.SecurityError{
		Security: "NextgenSession",
		Err:      domain.ErrInternal(errors.New("WithCSRFRequest is not wired")),
	}
	rec := httptest.NewRecorder()
	OgenErrorHandler(t.Context(), rec, httptest.NewRequest(http.MethodPost, "/teams", nil), err)

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	require.JSONEq(t, `{"code":"internal","message":"An unexpected error occurred."}`, rec.Body.String())
}

// Attributes failing the user schema keep their own code inside the server,
// but answer as request validation does: req.invalid with the stable message
// and the failing field paths, never the validator text.
func TestErrorResponseUserAttributesInvalidIsRequestInvalid(t *testing.T) {
	t.Parallel()

	_, validationErr := domain.NewCreateUser(domain.CreateUserParams{
		ProjectID:  "proj_1",
		SchemaURL:  "https://example.test/schema.json",
		Schema:     []byte(`{"type": "object", "required": ["country"], "properties": {"age": {"type": "integer"}, "country": {"type": "string"}}}`),
		Attributes: map[string]any{"age": "secret-value"},
	})
	require.ErrorIs(t, validationErr, domain.ErrUserAttributesInvalid(nil))

	got := errorResponse(userAttributesRequestInvalid(validationErr))

	require.Equal(t, http.StatusBadRequest, got.StatusCode)
	require.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), got.Response.Code)
	require.Equal(t, domain.ErrRequestInvalid().Message, got.Response.Message)
	body, err := got.Response.MarshalJSON()
	require.NoError(t, err)
	require.JSONEq(t, `{"code":"req.invalid","message":`+fmt.Sprintf("%q", domain.ErrRequestInvalid().Message)+
		`,"details":{"details":{"fields":["attributes.age","attributes.country"]}}}`, string(body))
	require.NotContains(t, string(body), "secret-value")

	// Outside the /users endpoints no request body carries attributes, so a
	// flow answers the failure as before.
	flow := errorResponse(validationErr)
	require.Equal(t, http.StatusBadRequest, flow.StatusCode)
	require.Equal(t, api.ErrorCode(domain.ErrUserInvalid().Code), flow.Response.Code)
	require.Equal(t, "user is not valid according to schema", flow.Response.Message)
	require.False(t, flow.Response.Details.Set)
}

// The domain names attributes by key; the API names them by their path from
// the request body, and a failure on the document itself names attributes.
func TestErrorResponseUserAttributesAreNamedByBodyPath(t *testing.T) {
	t.Parallel()

	conflict := errorResponse(domain.ErrUserAlreadyExists().WithDetails(domain.UserAttributesDetails{Keys: []domain.AttributeKey{"email"}}))
	require.Equal(t, http.StatusConflict, conflict.StatusCode)
	require.Equal(t, api.ErrorCode(domain.ErrUserAlreadyExists().Code), conflict.Response.Code)
	require.JSONEq(t, `{"fields":["attributes.email"]}`, string(conflict.Response.Details.Value["details"]))

	invalid := errorResponse(userAttributesRequestInvalid(domain.ErrUserAttributesInvalid(nil).
		WithDetails(domain.UserAttributesDetails{Keys: []domain.AttributeKey{"", "address.zip"}})))
	require.Equal(t, http.StatusBadRequest, invalid.StatusCode)
	require.JSONEq(t, `{"fields":["attributes","attributes.address.zip"]}`, string(invalid.Response.Details.Value["details"]))
}

// A schema failure that names no attributes has no fields to report, so it is
// answered as a schema failure, never as req.invalid with an empty list.
func TestErrorResponseUserAttributesInvalidWithoutKeysStaysUserInvalid(t *testing.T) {
	t.Parallel()

	got := errorResponse(userAttributesRequestInvalid(domain.ErrUserAttributesInvalid(nil)))
	require.Equal(t, http.StatusBadRequest, got.StatusCode)
	require.Equal(t, api.ErrorCode(domain.ErrUserInvalid().Code), got.Response.Code)
	require.False(t, got.Response.Details.Set)
}

// A credential IntrospectToken refuses is a 401; an introspection the server
// could not finish keeps the status of its fault: 503 for a token store that is
// unavailable, 501 for one that does not implement the read, and 500 for the
// rest, an unclassified error included. Answering any of them with 401 would
// tell every SDK its session is dead, and they clear the session cookie on a
// 401.
func TestOgenErrorHandlerIntrospectionFailure(t *testing.T) {
	t.Parallel()

	const (
		internal          = `{"code":"internal","message":"An unexpected error occurred."}`
		unavailable       = `{"code":"unavailable","message":"The service could not complete the request right now. Try again."}`
		notImplemented    = `{"code":"not_implemented","message":"This feature is not implemented yet."}`
		sessionRefused    = `{"code":"auth.unauthorized","message":"Missing or invalid session token."}`
		credentialRefused = `{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`
	)
	storeDown := domain.ErrInternal(errors.New("connection refused")).WithMessage("failed to read token record")
	storeUnavailable := domain.ErrUnavailable().WithParent(errors.New("retry budget spent"))
	keyUnwrapFailed := domain.ErrDecryptionFailed(errors.New("bad master key"))
	unclassified := errors.New("connection refused")

	for _, tc := range []struct {
		name       string
		method     string
		path       string
		bearer     bool
		err        error
		wantStatus int
		wantBody   string
	}{
		{"session me, token store down", http.MethodGet, "/sessions/me", false, storeDown, http.StatusInternalServerError, internal},
		{"session me, token store unavailable", http.MethodGet, "/sessions/me", false, storeUnavailable, http.StatusServiceUnavailable, unavailable},
		{"session me, token store not implemented", http.MethodGet, "/sessions/me", false, domain.ErrNotImplemented(), http.StatusNotImplemented, notImplemented},
		{"session me, key unwrap failed", http.MethodGet, "/sessions/me", false, keyUnwrapFailed, http.StatusInternalServerError, internal},
		{"session me, unclassified error", http.MethodGet, "/sessions/me", false, unclassified, http.StatusInternalServerError, internal},
		{"session me, revoked token", http.MethodGet, "/sessions/me", false, domain.ErrTokenRevoked(), http.StatusUnauthorized, sessionRefused},
		{"session me, invalid token", http.MethodGet, "/sessions/me", false, domain.ErrInvalidToken(), http.StatusUnauthorized, sessionRefused},
		{"user me, token store down", http.MethodGet, "/users/me", false, storeDown, http.StatusInternalServerError, internal},
		{"dual-scheme cookie, token store down", http.MethodGet, "/teams/team_1", false, storeDown, http.StatusInternalServerError, internal},
		{"dual-scheme cookie, token store unavailable", http.MethodGet, "/teams/team_1", false, storeUnavailable, http.StatusServiceUnavailable, unavailable},
		{"dual-scheme cookie, revoked token", http.MethodGet, "/teams/team_1", false, domain.ErrTokenRevoked(), http.StatusUnauthorized, credentialRefused},
		{"bearer, token store down", http.MethodGet, "/teams/team_1", true, storeDown, http.StatusInternalServerError, internal},
		{"bearer, token store unavailable", http.MethodGet, "/teams/team_1", true, storeUnavailable, http.StatusServiceUnavailable, unavailable},
		{"bearer, token store not implemented", http.MethodGet, "/teams/team_1", true, domain.ErrNotImplemented(), http.StatusNotImplemented, notImplemented},
		{"bearer, unclassified error", http.MethodGet, "/teams/team_1", true, unclassified, http.StatusInternalServerError, internal},
		{"bearer, revoked token", http.MethodGet, "/teams/team_1", true, domain.ErrTokenRevoked(), http.StatusUnauthorized, credentialRefused},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			mock := gomock.NewController(t)
			tokenService := mocks.NewMockTokenService(mock)
			tokenService.EXPECT().IntrospectToken(gomock.Any(), "credential").Return(nil, tc.err)
			srv := newErrorHandlerTestServer(t, tokenService)

			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.bearer {
				req.Header.Set("Authorization", "Bearer credential")
			} else {
				req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "credential"})
			}
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)

			require.Equal(t, tc.wantStatus, rec.Code)
			require.JSONEq(t, tc.wantBody, rec.Body.String())
		})
	}
}

// A credential whose JWE header names a key the server could never have
// sealed with is refused as a credential (401), never looked up. The key store
// here fails every lookup the way Postgres does for a kid with a NUL byte
// (SQLSTATE 22021), so a header that reached the lookup would answer 500 and
// let an anonymous request make every authenticated endpoint report an outage.
func TestOgenErrorHandlerMalformedCredentialHeader(t *testing.T) {
	t.Parallel()

	const (
		internal          = `{"code":"internal","message":"An unexpected error occurred."}`
		sessionRefused    = `{"code":"auth.unauthorized","message":"Missing or invalid session token."}`
		credentialRefused = `{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`
		mintedKid         = "enc_key_01JAAAAAAAAAAAAAAAAAAAAAAA"
	)

	for _, tc := range []struct {
		name       string
		header     string
		wantStatus int
	}{
		{"nul byte in kid", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"a\u0000b"}`, http.StatusUnauthorized},
		{"invalid utf-8 in kid", "{\"alg\":\"A256GCMKW\",\"enc\":\"A256GCM\",\"kid\":\"enc_key_\xff\xfe\"}", http.StatusUnauthorized},
		{"over-long kid", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"enc_key_` + strings.Repeat("A", 4096) + `"}`, http.StatusUnauthorized},
		{"unknown kid format", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"key-1"}`, http.StatusUnauthorized},
		{"unsupported enc", `{"alg":"A256GCMKW","enc":"A128CBC-HS256","kid":"` + mintedKid + `"}`, http.StatusUnauthorized},
		{"unsupported alg", `{"alg":"dir","enc":"A256GCM","kid":"` + mintedKid + `"}`, http.StatusUnauthorized},
		{"well-formed header, key store down", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"` + mintedKid + `"}`, http.StatusInternalServerError},
	} {
		credential := base64.RawURLEncoding.EncodeToString([]byte(tc.header)) + ".key.iv.ciphertext.tag"

		for _, scheme := range []struct {
			name    string
			path    string
			bearer  bool
			refused string
		}{
			{"session me", "/sessions/me", false, sessionRefused},
			{"bearer", "/teams/team_1", true, credentialRefused},
		} {
			t.Run(scheme.name+", "+tc.name, func(t *testing.T) {
				t.Parallel()
				mock := gomock.NewController(t)
				keys := mocks.NewMockKeyService(mock)
				keys.EXPECT().GetCrypter(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(nil, domain.ErrInternal(errors.New("invalid byte sequence for encoding \"UTF8\": 0x00 (SQLSTATE 22021)"))).
					AnyTimes()
				srv := newErrorHandlerTestServer(t, service.NewTokenService(keys, nil))

				req := httptest.NewRequest(http.MethodGet, scheme.path, nil)
				if scheme.bearer {
					req.Header.Set("Authorization", "Bearer "+credential)
				} else {
					req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: credential})
				}
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, req)

				want := scheme.refused
				if tc.wantStatus == http.StatusInternalServerError {
					want = internal
				}
				require.Equal(t, tc.wantStatus, rec.Code)
				require.JSONEq(t, want, rec.Body.String())
			})
		}
	}
}

// errorStubHandler answers GET /livez with err, or panics with panicValue.
type errorStubHandler struct {
	api.UnimplementedHandler
	err        error
	panicValue any
}

func (h errorStubHandler) GetLive(context.Context) (api.GetLiveRes, error) {
	if h.panicValue != nil {
		panic(h.panicValue)
	}
	return nil, h.err
}

// serveAndRecordLogs serves req the way the production chain does (WithRecover
// around the generated server, ogen's operation id middleware, a request
// logger that adds the request id) and returns the response and every record
// logged while serving it (see recordLogs). Not parallel: it changes globals.
func serveAndRecordLogs(t *testing.T, h api.Handler, tokenService service.TokenService, req *http.Request) (*httptest.ResponseRecorder, []map[string]any) {
	t.Helper()
	records := recordLogs(t)

	srv, err := api.NewServer(h, NewSecurityHandler(tokenService),
		api.WithErrorHandler(OgenErrorHandler),
		api.WithMiddleware(middleware.AddOperationIdToContext()),
	)
	require.NoError(t, err)

	ctx := middleware.WithRequestIDContext(req.Context(), "req_1")
	ctx = middleware.WithOperationIDContext(ctx, "")
	rec := httptest.NewRecorder()
	WithRecover(srv).ServeHTTP(rec, req.WithContext(ctx))
	return rec, records()
}

// recordLogs points slog.Default, which every logger lookup without a request
// logger falls back to, at a JSON recorder that adds the request id, and
// returns a function reading back every record logged so far. Not parallel:
// it changes globals.
func recordLogs(t *testing.T) func() []map[string]any {
	t.Helper()
	defaultLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(defaultLogger) })

	var logs bytes.Buffer
	slog.SetDefault(slog.New(slogctx.NewHandler(slog.NewJSONHandler(&logs, nil), &slogctx.HandlerOptions{
		Prependers: []slogctx.AttrExtractor{extractors.ExtractRequestID},
	})))

	return func() []map[string]any {
		var records []map[string]any
		for line := range bytes.Lines(logs.Bytes()) {
			var record map[string]any
			require.NoError(t, json.Unmarshal(line, &record))
			records = append(records, record)
		}
		return records
	}
}

// enableErrorOrigins turns on location and stack capture for the errors the
// test builds, and turns it off again afterwards.
func enableErrorOrigins(t *testing.T) {
	t.Helper()
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	t.Cleanup(func() {
		errreport.EnableLocation(false)
		errreport.EnableStack(false)
	})
}

// A handler error answered with a 5xx is logged once, at Error, with the
// request and operation it failed and where it was raised.
func TestOgenErrorHandlerLogsServerFaultOnce(t *testing.T) {
	enableErrorOrigins(t)
	rec, records := serveAndRecordLogs(t, errorStubHandler{err: errors.New("disk on fire")}, nil,
		httptest.NewRequest(http.MethodGet, "/livez", nil))

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	require.Len(t, records, 1)
	record := records[0]
	require.Equal(t, "ERROR", record["level"])
	require.Equal(t, "api error", record["msg"])
	require.EqualValues(t, http.StatusInternalServerError, record["status"])
	require.Equal(t, "getLive", record["operation_id"])
	require.Equal(t, "req_1", record["request_id"])
	logged, ok := record["error"].(map[string]any)
	require.True(t, ok, "error must be logged as a group: %v", record["error"])
	require.Equal(t, "internal", logged["code"])
	require.Equal(t, "An unexpected error occurred.", logged["message"])
	require.Equal(t, "disk on fire", logged["parent"])
	require.NotEmpty(t, logged["reportLocation"])
	require.NotEmpty(t, logged["stackTrace"])
}

// A handler error answered with a 4xx is logged once, at Info, with its code,
// message and cause but without the location and stack it captured.
func TestOgenErrorHandlerLogsClientErrorAtInfo(t *testing.T) {
	enableErrorOrigins(t)
	err := domain.ErrProjectNotFound().WithParent(errors.New("no rows in result set"))
	rec, records := serveAndRecordLogs(t, errorStubHandler{err: err}, nil,
		httptest.NewRequest(http.MethodGet, "/livez", nil))

	require.Equal(t, http.StatusNotFound, rec.Code)
	require.Len(t, records, 1)
	require.Equal(t, "INFO", records[0]["level"])
	require.EqualValues(t, http.StatusNotFound, records[0]["status"])
	requireBriefError(t, records[0], err.Code, err.Message, "no rows in result set")
}

// requireBriefError asserts the record logs the error without its location
// and stack, as every line below Error level does.
func requireBriefError(t *testing.T, record map[string]any, code, message, parent string) {
	t.Helper()
	logged, ok := record["error"].(map[string]any)
	require.True(t, ok, "error must be logged as a group: %v", record["error"])
	require.Equal(t, code, logged["code"])
	require.Equal(t, message, logged["message"])
	require.Contains(t, logged["parent"], parent)
	require.NotContains(t, logged, "reportLocation")
	require.NotContains(t, logged, "stackTrace")
}

// A body ogen cannot decode is logged as a body decode failure, without
// ogen's reason, which can quote the input. The client body keeps the stable
// message.
func TestOgenErrorHandlerLogsDecodeKind(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/projects", strings.NewReader(`{"name":`))
	req.Header.Set("Content-Type", "application/json")
	rec, records := serveAndRecordLogs(t, errorStubHandler{}, nil, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.JSONEq(t, `{"code":"req.invalid","message":`+fmt.Sprintf("%q", domain.ErrRequestInvalid().Message)+`}`, rec.Body.String())
	require.Len(t, records, 1)
	require.Equal(t, "INFO", records[0]["level"])
	require.Equal(t, "createProject", records[0]["operation_id"], "ogen fails before its middleware names the operation")
	logged := records[0]["error"].(map[string]any)
	require.Equal(t, "req.invalid", logged["code"])
	require.Equal(t, "decode body", logged["parent"])
}

// ogen's validation text can quote the rejected value, and a body can hold a
// secret: the log names the rejected field, never the value.
func TestOgenErrorHandlerLogOmitsRejectedValue(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/projects",
		strings.NewReader(`{"name":"p","origins":[{"pattern":"https://a.example","kind":"s3cr3t-value-xyz"}]}`))
	req.Header.Set("Content-Type", "application/json")
	rec, records := serveAndRecordLogs(t, errorStubHandler{}, nil, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), `"fields":["origins.[0].kind"]`)
	require.Len(t, records, 1)
	logged, err := json.Marshal(records[0]["error"])
	require.NoError(t, err)
	require.NotContains(t, string(logged), "s3cr3t-value-xyz")
	require.Contains(t, string(logged), "origins.[0].kind")
}

// Details are for the client: the log line never carries them.
func TestOgenErrorHandlerLogOmitsDetails(t *testing.T) {
	err := domain.ErrUserAlreadyExists().WithDetails(domain.UserAttributesDetails{Keys: []domain.AttributeKey{"email"}})
	rec, records := serveAndRecordLogs(t, errorStubHandler{err: err}, nil,
		httptest.NewRequest(http.MethodGet, "/livez", nil))

	require.Equal(t, http.StatusConflict, rec.Code)
	require.Contains(t, rec.Body.String(), "attributes.email")
	require.Len(t, records, 1)
	line, marshalErr := json.Marshal(records[0])
	require.NoError(t, marshalErr)
	require.NotContains(t, string(line), `"details"`)
	require.NotContains(t, string(line), "email")
}

// A security handler that could not decide is logged once, at Error, with
// the cause that kept it from deciding.
func TestOgenErrorHandlerLogsSecurityInternalErrorOnce(t *testing.T) {
	mock := gomock.NewController(t)
	tokenService := mocks.NewMockTokenService(mock)
	tokenService.EXPECT().IntrospectToken(gomock.Any(), "credential").
		Return(nil, domain.ErrInternal(errors.New("connection refused")).WithMessage("failed to read token record"))
	req := httptest.NewRequest(http.MethodGet, "/sessions/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "credential"})

	rec, records := serveAndRecordLogs(t, errorStubHandler{}, tokenService, req)

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	require.JSONEq(t, `{"code":"internal","message":"An unexpected error occurred."}`, rec.Body.String())
	require.Len(t, records, 1)
	record := records[0]
	require.Equal(t, "ERROR", record["level"])
	require.Equal(t, "api error", record["msg"])
	require.Equal(t, "getMySession", record["operation_id"])
	logged := record["error"].(map[string]any)
	require.Equal(t, "internal", logged["code"])
	require.Equal(t, "failed to read token record", logged["message"])
	require.Equal(t, "connection refused", logged["parent"])
}

// A request the client gave up on is logged at Warn, not as a server fault,
// though it still answers 500, whatever error its going away caused. A
// canceled error on a live request stays an Error, and so does a request
// net/http ended at the server's write deadline. Only the Error line carries
// the location and stack.
func TestOgenErrorHandlerLogsClientCancelAtWarn(t *testing.T) {
	for _, tc := range []struct {
		name      string
		cause     error
		canceled  bool
		wantLevel string
	}{
		{"client gone while the body is written", fmt.Errorf("write response: %w", &net.OpError{Op: "write", Net: "tcp", Err: errors.New("broken pipe")}), true, "WARN"},
		{"canceled error on a live request", fmt.Errorf("query projects: %w", context.Canceled), false, "ERROR"},
		{"server write deadline", fmt.Errorf("write response: %w", &net.OpError{Op: "write", Net: "tcp", Err: os.ErrDeadlineExceeded}), true, "ERROR"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			enableErrorOrigins(t)
			err := domain.ErrInternal(tc.cause)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if tc.canceled {
				cancel()
			}
			rec, records := serveAndRecordLogs(t, errorStubHandler{err: err}, nil,
				httptest.NewRequestWithContext(ctx, http.MethodGet, "/livez", nil))

			require.Equal(t, http.StatusInternalServerError, rec.Code)
			require.Len(t, records, 1)
			require.Equal(t, tc.wantLevel, records[0]["level"])
			require.EqualValues(t, http.StatusInternalServerError, records[0]["status"])
			if tc.wantLevel == "WARN" {
				requireBriefError(t, records[0], err.Code, err.Message, "broken pipe")
			} else {
				require.Contains(t, records[0]["error"], "stackTrace")
			}
		})
	}
}

// A line below Error level carries no location or stack in any mode. A text
// or JSON handler reads the error through its log value; GCP error reporting
// builds a report from any `error` attribute and reads the location and stack
// through the error's interfaces, at every level. A 5xx keeps both.
func TestLogAPIErrorBriefLinesCarryNoStackInGCPMode(t *testing.T) {
	enableErrorOrigins(t)
	notFound := domain.ErrProjectNotFound().WithParent(errors.New("no rows in result set"))
	internal := domain.ErrInternal(errors.New("disk on fire"))

	t.Run("plain mode", func(t *testing.T) {
		logged := loggedErrorValue(t, logAPIErrorRecord(t, http.StatusNotFound, notFound)).Resolve()
		require.Equal(t, slog.KindGroup, logged.Kind())
		var keys []string
		for _, attr := range logged.Group() {
			keys = append(keys, attr.Key)
		}
		require.ElementsMatch(t, []string{"code", "message", "parent"}, keys)
	})

	t.Run("gcp mode", func(t *testing.T) {
		errreport.GCPReporting(true)
		t.Cleanup(func() { errreport.GCPReporting(false) })

		brief := gcpReport(t, logAPIErrorRecord(t, http.StatusNotFound, notFound))
		require.Contains(t, brief, notFound.Message)
		require.NotContains(t, brief, "goroutine")
		require.NotContains(t, brief, "unsupported type")

		require.Contains(t, gcpReport(t, logAPIErrorRecord(t, http.StatusInternalServerError, internal)), "goroutine")
	})
}

// logAPIErrorRecord returns the record logAPIError writes, before any handler
// resolves its values.
func logAPIErrorRecord(t *testing.T, status int, err domain.Error) slog.Record {
	t.Helper()
	var records []slog.Record
	logAPIError(zlog.WithLoggingContext(t.Context(), slog.New(recordingHandler{records: &records})), status, err)
	require.Len(t, records, 1)
	return records[0]
}

func loggedErrorValue(t *testing.T, record slog.Record) slog.Value {
	t.Helper()
	var logged slog.Value
	record.Attrs(func(a slog.Attr) bool {
		if a.Key == zlog.ErrorAttributeKey {
			logged = a.Value
		}
		return true
	})
	return logged
}

// gcpReport is what the GCP error reporting handler writes for record.
func gcpReport(t *testing.T, record slog.Record) string {
	t.Helper()
	var out bytes.Buffer
	require.NoError(t, sloggcp.NewErrorReportingHandler(&out, nil).Handle(t.Context(), record))
	return out.String()
}

// recordingHandler keeps every record as logged, before any handler
// resolves its values.
type recordingHandler struct{ records *[]slog.Record }

func (h recordingHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h recordingHandler) Handle(_ context.Context, r slog.Record) error {
	*h.records = append(*h.records, r.Clone())
	return nil
}

func (h recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }

func (h recordingHandler) WithGroup(string) slog.Handler { return h }

// newRouterTestServer is newErrorHandlerTestServer with the answers to a path
// or method no operation takes, as the server mounts them (ADR 076).
func newRouterTestServer(t *testing.T, home *errorpage.Link) *api.Server {
	t.Helper()
	srv, err := api.NewServer(&Handler{}, NewSecurityHandler(nil),
		api.WithErrorHandler(OgenErrorHandler),
		api.WithNotFound(OgenNotFound(home)),
		api.WithMethodNotAllowed(OgenMethodNotAllowed),
	)
	require.NoError(t, err)
	return srv
}

// A path no operation matches answers a program with the envelope, so a client
// can tell a path this server lacks from a server that is not a Zitadel API,
// and a person with the error page.
func TestOgenNotFound(t *testing.T) {
	t.Parallel()
	srv := newRouterTestServer(t, &errorpage.Link{Label: "Open the console", Href: "/ui/console/"})

	for _, accept := range []string{"", "*/*", "application/json"} {
		t.Run("accept "+accept, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "/no-such-path", nil)
			if accept != "" {
				req.Header.Set("Accept", accept)
			}
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)

			require.Equal(t, http.StatusNotFound, rec.Code)
			require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			require.Equal(t, "Accept", rec.Header().Get("Vary"))
			require.JSONEq(t, `{"code":"req.not_found","message":"No API operation matches this path."}`, rec.Body.String())
		})
	}

	t.Run("a browser navigation", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodGet, "/no-such-path", nil)
		req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		require.Equal(t, http.StatusNotFound, rec.Code)
		require.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))
		require.Equal(t, "Accept", rec.Header().Get("Vary"))
		require.Contains(t, rec.Body.String(), `<h1 class="error-title">Page not found</h1>`)
		require.Contains(t, rec.Body.String(), `href="/ui/console/"`)
	})

	t.Run("a form post", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodPost, "/no-such-path", nil)
		req.Header.Set("Accept", "text/html")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		require.Equal(t, http.StatusNotFound, rec.Code)
		require.JSONEq(t, `{"code":"req.not_found","message":"No API operation matches this path."}`, rec.Body.String())
	})
}

// A path the API defines answers the envelope for a method its operations do
// not take, with the methods they do, while a CORS preflight keeps ogen's 204.
func TestOgenMethodNotAllowed(t *testing.T) {
	t.Parallel()
	srv := newRouterTestServer(t, nil)

	t.Run("wrong method", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodDelete, "/livez", nil)
		// A path the API defines is an API URL, browser or not.
		req.Header.Set("Accept", "text/html")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
		require.Equal(t, "GET", rec.Header().Get("Allow"))
		require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
		require.JSONEq(t, `{"code":"req.method_not_allowed","message":"The operations at this path do not accept this method."}`, rec.Body.String())
	})

	t.Run("CORS preflight", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodOptions, "/livez", nil)
		req.Header.Set("Access-Control-Request-Method", "GET")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		require.Equal(t, http.StatusNoContent, rec.Code)
		require.Equal(t, "GET", rec.Header().Get("Access-Control-Allow-Methods"))
		require.Empty(t, rec.Header().Get("Allow"))
		require.Empty(t, rec.Body.String())
	})
}

// A parameter that will not decode is named in details, as a body field is,
// so the req.invalid message never points at details that are not there.
func TestOgenErrorHandlerNamesTheInvalidParameter(t *testing.T) {
	t.Parallel()
	mock := gomock.NewController(t)
	tokenService := mocks.NewMockTokenService(mock)
	tokenService.EXPECT().IntrospectToken(gomock.Any(), "credential").
		Return(&domain.Token{Type: domain.TokenTypeProjectToken, ProjectID: "proj_1"}, nil)
	srv := newErrorHandlerTestServer(t, tokenService)

	req := httptest.NewRequest(http.MethodGet, "/users/123", nil)
	req.Header.Set("Authorization", "Bearer credential")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.JSONEq(t,
		`{"code":"req.invalid","message":"The request is invalid and fails base validation (missing required fields, wrong types, failed regex, etc.). Check the details for more information.","details":{"details":{"fields":["user_id"]}}}`,
		rec.Body.String(),
	)
}

// The log names the parameter that will not decode, never its value. Not
// parallel: serveAndRecordLogs changes globals.
func TestOgenErrorHandlerLogsTheInvalidParameterName(t *testing.T) {
	mock := gomock.NewController(t)
	tokenService := mocks.NewMockTokenService(mock)
	tokenService.EXPECT().IntrospectToken(gomock.Any(), "credential").
		Return(&domain.Token{Type: domain.TokenTypeProjectToken, ProjectID: "proj_1"}, nil)

	req := httptest.NewRequest(http.MethodGet, "/users/s3cr3t-value-xyz", nil)
	req.Header.Set("Authorization", "Bearer credential")
	rec, records := serveAndRecordLogs(t, errorStubHandler{}, tokenService, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), `"fields":["user_id"]`)
	require.Len(t, records, 1)
	logged := records[0]["error"].(map[string]any)
	require.Equal(t, "decode params: fields user_id", logged["parent"])
	line, err := json.Marshal(logged)
	require.NoError(t, err)
	require.NotContains(t, string(line), "s3cr3t-value-xyz")
}

func TestInvalidRequestFields(t *testing.T) {
	t.Parallel()

	param := &ogenerrors.DecodeParamsError{Err: &ogenerrors.DecodeParamError{
		Name: "user_id", In: "path", Err: errors.New(`pattern "^user_" does not match "123"`),
	}}
	require.Equal(t, []string{"user_id"}, invalidRequestFields(param))

	body := &ogenerrors.DecodeRequestError{Err: &validate.Error{Fields: []validate.FieldError{
		{Name: "attributes", Error: &validate.Error{Fields: []validate.FieldError{{Name: "email", Error: errors.New("required")}}}},
	}}}
	require.Equal(t, []string{"attributes.email"}, invalidRequestFields(body))

	require.Nil(t, invalidRequestFields(&ogenerrors.DecodeRequestError{Err: errors.New("unexpected end of JSON input")}))
}
