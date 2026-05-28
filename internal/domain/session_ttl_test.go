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
	})

	t.Run("negative rejected", func(t *testing.T) {
		override := -time.Minute
		_, err := domain.ResolveSessionTTL(&override, defaultTTL, maxTTL)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrSessionInvalidTTL())
	})

	t.Run("above max rejected", func(t *testing.T) {
		override := maxTTL + time.Second
		_, err := domain.ResolveSessionTTL(&override, defaultTTL, maxTTL)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrSessionInvalidTTL())
	})
}
