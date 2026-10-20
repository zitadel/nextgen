package api

import (
	"encoding/base64"
	"errors"
	"fmt"
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

// A credential IntrospectToken refuses is a 401; an introspection that could
// not reach the token store is a 500. Answering the outage with 401 would tell
// every SDK its session is dead, and they clear the session cookie on a 401.
func TestOgenErrorHandlerIntrospectionFailure(t *testing.T) {
	t.Parallel()

	const (
		internal          = `{"code":"internal","message":"An unexpected error occurred."}`
		sessionRefused    = `{"code":"auth.unauthorized","message":"Missing or invalid session token."}`
		credentialRefused = `{"code":"auth.unauthorized","message":"The request lacks valid authentication credentials."}`
	)
	storeDown := domain.ErrInternal(errors.New("connection refused")).WithMessage("failed to read token record")

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
		{"session me, revoked token", http.MethodGet, "/sessions/me", false, domain.ErrTokenRevoked(), http.StatusUnauthorized, sessionRefused},
		{"session me, invalid token", http.MethodGet, "/sessions/me", false, domain.ErrInvalidToken(), http.StatusUnauthorized, sessionRefused},
		{"user me, token store down", http.MethodGet, "/users/me", false, storeDown, http.StatusInternalServerError, internal},
		{"dual-scheme cookie, token store down", http.MethodGet, "/teams/team_1", false, storeDown, http.StatusInternalServerError, internal},
		{"dual-scheme cookie, revoked token", http.MethodGet, "/teams/team_1", false, domain.ErrTokenRevoked(), http.StatusUnauthorized, credentialRefused},
		{"bearer, token store down", http.MethodGet, "/teams/team_1", true, storeDown, http.StatusInternalServerError, internal},
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
