package errlog_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/nextgen/internal/instrumentation/errlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// logLine returns the one JSON line Log writes for err on a context that is
// done when canceled is set.
func logLine(t *testing.T, canceled bool, err error, attrs ...slog.Attr) map[string]any {
	t.Helper()
	var out bytes.Buffer
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	if canceled {
		cancel()
	}
	ctx = zlog.WithLoggingContext(ctx, slog.New(slog.NewJSONHandler(&out, nil)).With("request_id", "req_1"))

	errlog.Log(ctx, err, attrs...)

	var record map[string]any
	require.NoError(t, json.Unmarshal(out.Bytes(), &record), "one line: %q", out.String())
	return record
}

func enableErrorOrigins(t *testing.T) {
	t.Helper()
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	t.Cleanup(func() {
		errreport.EnableLocation(false)
		errreport.EnableStack(false)
	})
}

// The level comes from the error: a server fault logs at Error, or at Warn
// once the client has walked away, and everything else at Info.
func TestLog_level(t *testing.T) {
	enableErrorOrigins(t)
	for _, tc := range []struct {
		name      string
		err       error
		canceled  bool
		wantLevel string
	}{
		{"client error", domain.ErrProjectNotFound(), false, "INFO"},
		{"client error, client gone", domain.ErrProjectNotFound(), true, "INFO"},
		{"server fault", domain.ErrInternal(errors.New("disk on fire")), false, "ERROR"},
		{"unavailable", domain.ErrFlowSSOUnavailable(errors.New("timeout")), false, "ERROR"},
		{"server fault, client gone", domain.ErrInternal(fmt.Errorf("write: %w", &net.OpError{Op: "write", Err: errors.New("broken pipe")})), true, "WARN"},
		{"server write deadline", domain.ErrInternal(fmt.Errorf("write: %w", os.ErrDeadlineExceeded)), true, "ERROR"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			record := logLine(t, tc.canceled, tc.err)
			require.Equal(t, tc.wantLevel, record["level"])
			require.Equal(t, "api error", record["msg"])
			require.Equal(t, "req_1", record["request_id"])
			require.NotContains(t, record, "status")
			require.NotContains(t, record, "operation_id")
			logged, ok := record["error"].(map[string]any)
			require.True(t, ok, "the error is a group: %v", record["error"])
			if tc.wantLevel == "ERROR" {
				require.Contains(t, logged, "stackTrace")
			} else {
				require.NotContains(t, logged, "stackTrace")
			}
		})
	}
}

// A 5xx answer logs at Error whatever the error's code, or at Warn once the
// client has walked away.
func TestLogFault(t *testing.T) {
	enableErrorOrigins(t)
	for _, tc := range []struct {
		name      string
		err       error
		canceled  bool
		wantLevel string
	}{
		{"client code answered 500", domain.ErrProjectNotFound(), false, "ERROR"},
		{"plain error", errors.New("disk on fire"), false, "ERROR"},
		{"client gone", domain.ErrProjectNotFound(), true, "WARN"},
		{"server write deadline", domain.ErrInternal(fmt.Errorf("write: %w", os.ErrDeadlineExceeded)), true, "ERROR"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if tc.canceled {
				cancel()
			}
			ctx = zlog.WithLoggingContext(ctx, slog.New(slog.NewJSONHandler(&out, nil)))

			errlog.LogFault(ctx, tc.err)

			var record map[string]any
			require.NoError(t, json.Unmarshal(out.Bytes(), &record), "one line: %q", out.String())
			require.Equal(t, tc.wantLevel, record["level"])
			require.Equal(t, "api error", record["msg"])
			require.NotContains(t, record, "status")
			logged := record["error"].(map[string]any)
			if tc.wantLevel == "ERROR" {
				require.Contains(t, logged, "stackTrace")
			} else {
				require.NotContains(t, logged, "stackTrace")
			}
		})
	}
}

// An error that is not a domain error is a server fault and logs as one.
func TestLog_wrapsAPlainError(t *testing.T) {
	record := logLine(t, false, errors.New("disk on fire"))

	require.Equal(t, "ERROR", record["level"])
	logged := record["error"].(map[string]any)
	require.Equal(t, "internal", logged["code"])
	require.Equal(t, "disk on fire", logged["parent"])
}

// The attributes a site adds sit beside the error.
func TestLog_attrs(t *testing.T) {
	record := logLine(t, false, domain.ErrRequestInvalid(),
		slog.String("step", "password"), slog.String("step_error", "invalid"))

	require.Equal(t, "password", record["step"])
	require.Equal(t, "invalid", record["step_error"])
}

// The explicit level is used as given, and decides the shape: brief below
// Error, full at Error.
func TestLogLevel(t *testing.T) {
	enableErrorOrigins(t)
	err := domain.ErrInternal(errors.New("disk on fire"))
	for _, tc := range []struct {
		level     slog.Level
		wantLevel string
		wantStack bool
	}{
		{slog.LevelWarn, "WARN", false},
		{slog.LevelError, "ERROR", true},
	} {
		t.Run(tc.wantLevel, func(t *testing.T) {
			var out bytes.Buffer
			ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewJSONHandler(&out, nil)))

			errlog.LogLevel(ctx, tc.level, err, slog.String("slug", "acme"))

			var record map[string]any
			require.NoError(t, json.Unmarshal(out.Bytes(), &record))
			require.Equal(t, tc.wantLevel, record["level"])
			require.Equal(t, "api error", record["msg"])
			require.Equal(t, "acme", record["slug"])
			logged := record["error"].(map[string]any)
			require.Equal(t, "disk on fire", logged["parent"])
			if tc.wantStack {
				require.Contains(t, logged, "stackTrace")
			} else {
				require.NotContains(t, logged, "stackTrace")
			}
		})
	}
}
