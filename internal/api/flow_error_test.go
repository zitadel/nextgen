package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestDecodeFlowFields_sanitizedCause(t *testing.T) {
	t.Parallel()

	_, err := decodeFlowFields(map[string]jx.Raw{
		"email": jx.Raw(`{"secret":`),
	})
	require.Error(t, err)
	assert.Equal(t, `invalid value for field "email"`, err.Error())

	var syntax *json.SyntaxError
	require.ErrorAs(t, err, &syntax, "Unwrap must preserve the json.Unmarshal cause")

	var decodeErr *flowFieldDecodeError
	require.ErrorAs(t, err, &decodeErr)
	logVal := decodeErr.LogValue()
	require.Equal(t, slog.KindGroup, logVal.Kind())
	attrs := logVal.Group()
	got := make(map[string]string, len(attrs))
	for _, a := range attrs {
		got[a.Key] = a.Value.String()
	}
	assert.Equal(t, map[string]string{
		"kind":  "field_value",
		"field": "email",
	}, got)
	assert.NotContains(t, fmt.Sprint(attrs), "secret")
}

func TestDecodeFlowFields_outOfRangeNumber(t *testing.T) {
	t.Parallel()

	// ogen RawAppend accepts 1e1000 as syntactically valid JSON; encoding/json
	// cannot represent it as float64, so decodeFlowFields must fail with a
	// field-value message (not "invalid JSON").
	_, err := decodeFlowFields(map[string]jx.Raw{
		"score": jx.Raw(`1e1000`),
	})
	require.Error(t, err)
	assert.Equal(t, `invalid value for field "score"`, err.Error())
	assert.NotContains(t, err.Error(), "JSON")

	var decodeErr *flowFieldDecodeError
	require.ErrorAs(t, err, &decodeErr)
	assert.Equal(t, "score", decodeErr.field)
	require.Error(t, decodeErr.err)
}

func TestSubmitFlowFieldsDecode_attachesLogSafeParent(t *testing.T) {
	t.Parallel()

	cause := &flowFieldDecodeError{
		field: "phone",
		err:   errors.New(`invalid character '{' looking for beginning of object key string in {"password":"hunter2"}`),
	}
	dom := domain.ErrRequestInvalid().WithMessage(cause.Error()).WithParent(cause)
	assert.Equal(t, `invalid value for field "phone"`, dom.Message)
	assert.Equal(t, cause, dom.Parent)

	// Parent LogValue must not surface the unmarshal / payload fragment.
	parentLV, ok := dom.Parent.(slog.LogValuer)
	require.True(t, ok)
	for _, a := range parentLV.LogValue().Group() {
		assert.NotContains(t, a.Value.String(), "hunter2")
		assert.NotContains(t, a.Value.String(), "password")
	}
}

func TestMapFlowErrorStatus_usesFlowSentinels(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{
			name:       "cookie invalid",
			err:        domain.ErrFlowCookieInvalid(),
			wantStatus: http.StatusUnauthorized,
			wantCode:   "flow.cookie_invalid",
			wantMsg:    "flow cookie is missing or invalid",
		},
		{
			name:       "wrapped invalid action uses fixed message",
			err:        fmt.Errorf("%w: %q on step %q", domain.ErrFlowInvalidAction(), "submit", "start"),
			wantStatus: http.StatusBadRequest,
			wantCode:   "flow.invalid_action",
			wantMsg:    "action is not allowed on the current step",
		},
		{
			name:       "session conflict",
			err:        domain.ErrFlowSessionConflict(),
			wantStatus: http.StatusConflict,
			wantCode:   "flow.session_conflict",
			wantMsg:    "flow session version conflict",
		},
		{
			name:       "completed",
			err:        domain.ErrFlowCompleted(),
			wantStatus: http.StatusGone,
			wantCode:   "flow.completed",
			wantMsg:    "flow has already completed",
		},
		{
			name:       "legacy alias still matches",
			err:        fmt.Errorf("%w: cross-flow", domain.ErrFlowUnsupported()),
			wantStatus: http.StatusBadRequest,
			wantCode:   "flow.unsupported",
			wantMsg:    "flow feature is not supported",
		},
		{
			name:       "wrapped restart required drops the resolved values",
			err:        fmt.Errorf("%w: schema https://a.example.test/user.json", domain.ErrFlowRestartRequired()),
			wantStatus: http.StatusConflict,
			wantCode:   "flow.restart_required",
			wantMsg:    "the flow must be restarted",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// The handlers return normalizeFlowError's result and let
			// OgenErrorHandler build the response, so assert on that pairing.
			got := errorResponse(normalizeFlowError(tt.err))
			require.NotNil(t, got)
			assert.Equal(t, tt.wantStatus, got.StatusCode)
			assert.Equal(t, tt.wantCode, string(got.Response.Code))
			assert.Equal(t, tt.wantMsg, got.Response.Message)
			assert.NotContains(t, got.Response.Message, "on step")
		})
	}
}

func TestMapFlowGetError_restartRequiredIs409(t *testing.T) {
	t.Parallel()

	res, err := mapFlowGetError(recordingContext(t), fmt.Errorf("%w: other schema", domain.ErrFlowRestartRequired()))
	require.NoError(t, err)
	conflict, ok := res.(*api.GetFlowStepConflict)
	require.True(t, ok, "got %T", res)
	assert.Equal(t, "flow.restart_required", string(conflict.Code))
	assert.Equal(t, "the flow must be restarted", conflict.Message)
}

func TestMapFlowGetError_releaseRevokedIs409(t *testing.T) {
	t.Parallel()

	res, err := mapFlowGetError(recordingContext(t), domain.ErrReleaseRevoked())
	require.NoError(t, err)
	conflict, ok := res.(*api.GetFlowStepConflict)
	require.True(t, ok, "got %T", res)
	assert.Equal(t, "rel.revoked", string(conflict.Code))
}

// Every typed answer bypasses the ogen error sink, so mapFlowGetError records
// the error it decided on, wrapping and all, for the error line; an error it
// does not answer goes back to ogen unrecorded, which records it itself.
func TestMapFlowGetError_recordsTheErrorItAnswers(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		want api.GetFlowStepRes
	}{
		{name: "an invalid cookie", err: domain.ErrFlowCookieInvalid(), want: &api.GetFlowStepNotFound{}},
		{name: "an expired cookie", err: domain.ErrFlowCookieExpired(), want: &api.GetFlowStepNotFound{}},
		{name: "an unknown flow", err: fmt.Errorf("open: %w", domain.ErrFlowNotFound()), want: &api.GetFlowStepNotFound{}},
		{name: "a completed flow", err: domain.ErrFlowCompleted(), want: &api.GetFlowStepGone{}},
		{name: "a restart", err: domain.ErrFlowRestartRequired().WithParent(errors.New("other schema")), want: &api.GetFlowStepConflict{}},
		{name: "a revoked release", err: domain.ErrReleaseRevoked(), want: &api.GetFlowStepConflict{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx := recordingContext(t)
			res, err := mapFlowGetError(ctx, tt.err)
			require.NoError(t, err)
			require.IsType(t, tt.want, res)
			recorded, ok := middleware.RecordedError(ctx)
			require.True(t, ok, "the answer records its error")
			assert.Equal(t, tt.err, recorded, "the original error, with its cause and location")
		})
	}

	t.Run("an error it does not answer", func(t *testing.T) {
		t.Parallel()
		ctx := recordingContext(t)
		res, err := mapFlowGetError(ctx, errors.New("disk on fire"))
		require.Error(t, err)
		assert.Nil(t, res)
		_, ok := middleware.RecordedError(ctx)
		assert.False(t, ok, "ogen's sink records what it is handed")
	})
}
