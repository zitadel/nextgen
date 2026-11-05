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
// Error() text alone would drop, and where each was raised, but no stack at
// any depth.
func TestError_briefLogValue_keepsNestedCause(t *testing.T) {
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	t.Cleanup(func() {
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	err := domain.ErrProjectNotFound().WithParent(
		domain.ErrInternal(errors.New("pq: connection reset")).WithMessage("failed to load project"))
	var out bytes.Buffer
	slog.New(slog.NewJSONHandler(&out, nil)).Info("api error", slog.Attr{Key: "error", Value: err.BriefLogValue()})

	var record map[string]any
	require.NoError(t, json.Unmarshal(out.Bytes(), &record))
	parent, ok := record["error"].(map[string]any)["parent"].(map[string]any)
	require.True(t, ok, "the nested domain error is a group: %v", record["error"])
	assert.Equal(t, "internal", parent["code"])
	assert.Equal(t, "failed to load project", parent["message"])
	assert.Equal(t, "pq: connection reset", parent["parent"])
	assert.NotEmpty(t, record["error"].(map[string]any)["reportLocation"])
	assert.NotEmpty(t, parent["reportLocation"])
	assert.NotContains(t, out.String(), "stackTrace")
}

// The brief shape names the location in GCP mode too: the brief error hides
// the origin interfaces from the handler, so the value must carry it.
func TestError_briefLogValue_gcpKeepsLocation(t *testing.T) {
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	errreport.GCPReporting(true)
	t.Cleanup(func() {
		errreport.GCPReporting(false)
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	var keys []string
	for _, attr := range logValueAttrs(t, domain.ErrInternal(errors.New("cause")).BriefLogValue()) {
		keys = append(keys, attr.Key)
	}

	assert.Contains(t, keys, "reportLocation")
	assert.NotContains(t, keys, "stackTrace")
}

func TestIsServerFault(t *testing.T) {
	assert.True(t, domain.IsServerFault(errors.New("driver detail")), "a non-domain error")
	assert.True(t, domain.IsServerFault(fmt.Errorf("read: %w", domain.ErrFailedToDecryptVariable(nil))), "a wrapped server fault")
	assert.False(t, domain.IsServerFault(domain.ErrAuthAttemptNotFound()), "a client error")
}
