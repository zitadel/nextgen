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

func TestPlatformConfigValidate(t *testing.T) {
	t.Run("zero value validates (bootstrap off by default)", func(t *testing.T) {
		require.NoError(t, PlatformConfig{}.Validate())
	})

	t.Run("bootstrap enabled without project id errors", func(t *testing.T) {
		err := PlatformConfig{BootstrapProject: true}.Validate()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "platform.bootstrap_project")
		assert.Contains(t, err.Error(), "platform.project_id")
	})

	t.Run("bootstrap enabled with project id validates", func(t *testing.T) {
		require.NoError(t, PlatformConfig{BootstrapProject: true, ProjectID: "proj_platform"}.Validate())
	})

	t.Run("project id without bootstrap validates", func(t *testing.T) {
		require.NoError(t, PlatformConfig{ProjectID: "proj_platform"}.Validate())
	})
}
