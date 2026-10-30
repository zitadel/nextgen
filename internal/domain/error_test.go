package domain_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/sloggcp"
)

func TestError_messageOnly(t *testing.T) {
	parent := errors.New("driver detail")
	err := domain.ErrInternal(parent)

	assert.Equal(t, "An unexpected error occurred.", err.Error())
}

func TestError_unwrap(t *testing.T) {
	parent := errors.New("driver detail")
	err := domain.ErrInternal(parent)

	assert.Same(t, parent, errors.Unwrap(err))
	assert.True(t, errors.Is(err, parent))
}

func logValueAttrs(t *testing.T, v slog.Value) []slog.Attr {
	t.Helper()
	require.Equal(t, slog.KindGroup, v.Kind())
	return v.Group()
}

func TestError_logValue_omitsDetails(t *testing.T) {
	err := domain.ErrRequestInvalid().WithDetails(map[string]string{"field": "email"})

	for _, attr := range logValueAttrs(t, err.LogValue()) {
		assert.NotEqual(t, "details", attr.Key)
	}
}

func TestError_logValue_includesParent(t *testing.T) {
	parent := errors.New("storage")
	err := domain.ErrInternal(parent)

	var hasParent bool
	for _, attr := range logValueAttrs(t, err.LogValue()) {
		if attr.Key == "parent" {
			hasParent = true
			assert.Equal(t, "storage", attr.Value.String())
		}
	}
	assert.True(t, hasParent)
}

func TestError_logValue_gcpOmitsLocationAndStack(t *testing.T) {
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	errreport.GCPReporting(true)
	t.Cleanup(func() {
		errreport.GCPReporting(false)
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	err := domain.ErrInternal(errors.New("cause"))

	var keys []string
	for _, attr := range logValueAttrs(t, err.LogValue()) {
		keys = append(keys, attr.Key)
	}

	assert.NotContains(t, keys, "reportLocation")
	assert.NotContains(t, keys, "stackTrace")
}

func TestError_logValue_nonGCPIncludesLocationWhenEnabled(t *testing.T) {
	errreport.EnableLocation(true)
	errreport.EnableStack(false)
	errreport.GCPReporting(false)
	t.Cleanup(func() {
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
		errreport.GCPReporting(false)
	})

	err := domain.ErrInternal(nil)

	var hasLocation bool
	for _, attr := range logValueAttrs(t, err.LogValue()) {
		if attr.Key == "reportLocation" {
			hasLocation = true
		}
	}
	require.True(t, hasLocation)
}

// A brief line keeps the root cause of a nested domain error, which its
// Error() text alone would drop, and where it was raised, but no stack at
// any depth. In GCP mode the location is left to the handler, which reads it
// through the error's interface.
func TestError_briefLogValue_keepsNestedCause(t *testing.T) {
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	t.Cleanup(func() {
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	err := domain.ErrProjectNotFound().WithParent(
		domain.ErrInternal(errors.New("pq: connection reset")).WithMessage("failed to load project"))
	briefLine := func(t *testing.T) (map[string]any, string) {
		t.Helper()
		var out bytes.Buffer
		slog.New(slog.NewJSONHandler(&out, nil)).Info("api error", slog.Attr{Key: "error", Value: err.BriefLogValue()})
		var record map[string]any
		require.NoError(t, json.Unmarshal(out.Bytes(), &record))
		logged, ok := record["error"].(map[string]any)
		require.True(t, ok, "the error is a group: %v", record["error"])
		return logged, out.String()
	}

	logged, line := briefLine(t)
	parent, ok := logged["parent"].(map[string]any)
	require.True(t, ok, "the nested domain error is a group: %v", logged)
	assert.Equal(t, "internal", parent["code"])
	assert.Equal(t, "failed to load project", parent["message"])
	assert.Equal(t, "pq: connection reset", parent["parent"])
	assert.Contains(t, logged, "reportLocation")
	assert.Contains(t, parent, "reportLocation")
	assert.NotContains(t, line, "stackTrace")

	t.Run("gcp mode", func(t *testing.T) {
		errreport.GCPReporting(true)
		t.Cleanup(func() { errreport.GCPReporting(false) })

		_, line := briefLine(t)
		assert.NotContains(t, line, "reportLocation")
		assert.NotContains(t, line, "stackTrace")
	})
}

// A brief error hands a handler its location, never its stack.
func TestError_brief_exposesTheLocationNotTheStack(t *testing.T) {
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	t.Cleanup(func() {
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	brief := domain.ErrInternal(errors.New("cause")).Brief()

	located, ok := errors.AsType[sloggcp.ReportLocationError](brief)
	require.True(t, ok)
	assert.NotNil(t, located.ReportLocation())
	_, ok = errors.AsType[sloggcp.StackTraceError](brief)
	assert.False(t, ok)
}

func TestIsDependencyFault(t *testing.T) {
	assert.True(t, domain.IsDependencyFault(domain.ErrUnavailable()), "the database did not answer")
	assert.True(t, domain.IsDependencyFault(domain.ErrFlowStepRejected().WithParent(domain.ErrFlowSSOUnavailable(errors.New("discovery timed out")))), "a provider did not answer, behind a step rejection")
	assert.True(t, domain.IsDependencyFault(fmt.Errorf("read: %w", domain.ErrUnavailable())), "a wrapped one")
	assert.False(t, domain.IsDependencyFault(domain.ErrInternal(errors.New("disk on fire"))), "a server fault of its own")
	assert.False(t, domain.IsDependencyFault(domain.ErrAuthAttemptNotFound()), "a client error")
	assert.False(t, domain.IsDependencyFault(nil))
}

func TestIsServerFault(t *testing.T) {
	assert.True(t, domain.IsServerFault(errors.New("driver detail")), "a non-domain error")
	assert.True(t, domain.IsServerFault(fmt.Errorf("read: %w", domain.ErrFailedToDecryptVariable(nil))), "a wrapped server fault")
	assert.False(t, domain.IsServerFault(domain.ErrAuthAttemptNotFound()), "a client error")
}
