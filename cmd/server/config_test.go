package server

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/service"
)

func TestServiceSessionConfigValidate(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		err := (service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour}).Validate()
		require.NoError(t, err)
	})

	t.Run("default exceeds max", func(t *testing.T) {
		err := (service.SessionConfig{DefaultTTL: 2 * time.Hour, MaxTTL: time.Hour}).Validate()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "default_ttl")
	})

	t.Run("non-positive default", func(t *testing.T) {
		err := (service.SessionConfig{DefaultTTL: 0, MaxTTL: time.Hour}).Validate()
		require.Error(t, err)
	})

	t.Run("non-positive max", func(t *testing.T) {
		err := (service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 0}).Validate()
		require.Error(t, err)
	})
}
