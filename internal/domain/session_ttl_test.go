package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestResolveSessionTTL(t *testing.T) {
	const (
		defaultTTL = time.Hour
		maxTTL     = 24 * time.Hour
	)

	t.Run("nil uses default", func(t *testing.T) {
		got, err := domain.ResolveSessionTTL(nil, defaultTTL, maxTTL)
		require.NoError(t, err)
		assert.Equal(t, defaultTTL, got)
	})

	t.Run("valid override", func(t *testing.T) {
		override := 2 * time.Hour
		got, err := domain.ResolveSessionTTL(&override, defaultTTL, maxTTL)
		require.NoError(t, err)
		assert.Equal(t, override, got)
	})

	t.Run("max boundary", func(t *testing.T) {
		override := maxTTL
		got, err := domain.ResolveSessionTTL(&override, defaultTTL, maxTTL)
		require.NoError(t, err)
		assert.Equal(t, maxTTL, got)
	})

	t.Run("zero rejected", func(t *testing.T) {
		override := time.Duration(0)
		_, err := domain.ResolveSessionTTL(&override, defaultTTL, maxTTL)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrSessionInvalidTTL())
		assertSessionInvalidTTLDetails(t, err, 0, maxTTL)
	})

	t.Run("negative rejected", func(t *testing.T) {
		override := -time.Minute
		_, err := domain.ResolveSessionTTL(&override, defaultTTL, maxTTL)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrSessionInvalidTTL())
		assertSessionInvalidTTLDetails(t, err, override, maxTTL)
	})

	t.Run("above max rejected", func(t *testing.T) {
		override := maxTTL + time.Second
		_, err := domain.ResolveSessionTTL(&override, defaultTTL, maxTTL)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrSessionInvalidTTL())
		assertSessionInvalidTTLDetails(t, err, override, maxTTL)
	})
}

func assertSessionInvalidTTLDetails(t *testing.T, err error, wantTTL, wantMax time.Duration) {
	t.Helper()
	var domErr domain.Error
	require.ErrorAs(t, err, &domErr)
	details, ok := domErr.Details.(domain.SessionInvalidTTLDetails)
	require.True(t, ok)
	assert.Equal(t, wantTTL, details.TTL.Std())
	assert.Equal(t, wantMax, details.MaxTTL.Std())
}
