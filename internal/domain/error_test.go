package domain_test

import (
	"errors"
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
