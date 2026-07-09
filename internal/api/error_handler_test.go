package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-faster/errors"
	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

func TestOgenErrorHandlerSessionCookieSecurityError(t *testing.T) {
	t.Parallel()

	for _, op := range []struct {
		name api.OperationName
		id   string
	}{
		{api.GetMySessionOperation, "getMySession"},
		{api.RevokeMySessionOperation, "revokeMySession"},
		{api.GetMyUserOperation, "getMyUser"},
	} {
		t.Run(op.id, func(t *testing.T) {
			t.Parallel()

			// Missing cookie: ogen reports an unsatisfied requirement without
			// naming the scheme.
			missing := &ogenerrors.SecurityError{
				OperationContext: ogenerrors.OperationContext{Name: op.name, ID: op.id},
				Err:              ogenerrors.ErrSecurityRequirementIsNotSatisfied,
			}
			// Invalid cookie: the SecurityHandler rejected the credential.
			invalid := &ogenerrors.SecurityError{
				OperationContext: ogenerrors.OperationContext{Name: op.name, ID: op.id},
				Security:         "NextgenSession",
				Err:              ogenerrors.ErrSecurityRequirementIsNotSatisfied,
			}

			for _, err := range []error{missing, invalid} {
				rec := httptest.NewRecorder()
				OgenErrorHandler(context.Background(), rec, httptest.NewRequest(http.MethodGet, "/", nil), err)

				require.Equal(t, http.StatusUnauthorized, rec.Code)
				require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
				require.JSONEq(t,
					`{"code":"auth.unauthorized","message":"Missing or invalid session token."}`,
					rec.Body.String(),
				)
			}
		})
	}
}

func TestOgenErrorHandlerOtherSecurityError(t *testing.T) {
	t.Parallel()

	err := &ogenerrors.SecurityError{
		OperationContext: ogenerrors.OperationContext{Name: api.CreateSchemaOperation, ID: "createSchema"},
		Err:              ogenerrors.ErrSecurityRequirementIsNotSatisfied,
	}

	rec := httptest.NewRecorder()
	OgenErrorHandler(context.Background(), rec, httptest.NewRequest(http.MethodPost, "/", nil), err)

	require.Equal(t, http.StatusUnauthorized, rec.Code)

	var details api.ErrorDetails
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &details))
	require.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
	// Non-cookie schemes keep the raw ogen message until the ADR 030
	// Decision 6 normalization lands.
	require.Equal(t, err.Error(), details.Message)
}

func TestOgenErrorHandlerDecodeParamsError(t *testing.T) {
	t.Parallel()

	err := &ogenerrors.DecodeParamsError{
		OperationContext: ogenerrors.OperationContext{Name: api.GetSessionOperation, ID: "getSession"},
		Err:              errors.New("query: session_id: invalid"),
	}

	rec := httptest.NewRecorder()
	OgenErrorHandler(context.Background(), rec, httptest.NewRequest(http.MethodGet, "/", nil), err)

	require.Equal(t, http.StatusBadRequest, rec.Code)

	var details api.ErrorDetails
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &details))
	require.Equal(t, api.ErrorCode("req.invalid"), details.Code)
}
