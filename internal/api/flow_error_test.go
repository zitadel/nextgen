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
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := mapFlowErrorStatus(tt.err)
			require.NotNil(t, got)
			assert.Equal(t, tt.wantStatus, got.StatusCode)
			assert.Equal(t, tt.wantCode, string(got.Response.Code))
			assert.Equal(t, tt.wantMsg, got.Response.Message)
			assert.NotContains(t, got.Response.Message, "on step")
		})
	}
}
