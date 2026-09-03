package server

import (
	"reflect"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

func TestServiceSessionConfigValidate(t *testing.T) {
	t.Parallel()
	t.Run("valid", func(t *testing.T) {
		t.Parallel()
		err := (service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour}).Validate()
		require.NoError(t, err)
	})

	t.Run("default exceeds max", func(t *testing.T) {
		t.Parallel()
		err := (service.SessionConfig{DefaultTTL: 2 * time.Hour, MaxTTL: time.Hour}).Validate()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "default_ttl")
	})

	t.Run("non-positive default", func(t *testing.T) {
		t.Parallel()
		err := (service.SessionConfig{DefaultTTL: 0, MaxTTL: time.Hour}).Validate()
		require.Error(t, err)
	})

	t.Run("non-positive max", func(t *testing.T) {
		t.Parallel()
		err := (service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 0}).Validate()
		require.Error(t, err)
	})
}

func TestPlatformConfigValidate(t *testing.T) {
	t.Parallel()
	t.Run("zero value validates (bootstrap off by default)", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, PlatformConfig{}.Validate())
	})

	t.Run("bootstrap enabled without project id validates (server owns the id)", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, PlatformConfig{BootstrapProject: true}.Validate())
	})

	t.Run("bootstrap enabled with the built-in project id validates", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, PlatformConfig{BootstrapProject: true, ProjectID: "proj_platform"}.Validate())
	})

	t.Run("bootstrap enabled with a diverging project id errors", func(t *testing.T) {
		t.Parallel()
		err := PlatformConfig{BootstrapProject: true, ProjectID: "proj_other"}.Validate()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "platform.bootstrap_project")
		assert.Contains(t, err.Error(), "proj_platform")
	})

	t.Run("pinned project id without bootstrap validates", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, PlatformConfig{ProjectID: "proj_01H0000000000000000000000"}.Validate())
	})

	t.Run("project id without the proj_ prefix errors", func(t *testing.T) {
		t.Parallel()
		err := PlatformConfig{ProjectID: "platform"}.Validate()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "platform.project_id")
	})

	t.Run("project id with an empty body errors", func(t *testing.T) {
		t.Parallel()
		require.Error(t, PlatformConfig{ProjectID: "proj_"}.Validate())
	})

	t.Run("project id with the wrong prefix errors", func(t *testing.T) {
		t.Parallel()
		require.Error(t, PlatformConfig{ProjectID: "user_01H0000000000000000000000"}.Validate())
	})
}

func TestPlatformConfigResolvedProjectID(t *testing.T) {
	t.Parallel()
	t.Run("bootstrap resolves to the built-in id", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "proj_platform", PlatformConfig{BootstrapProject: true}.ResolvedProjectID())
	})

	t.Run("bootstrap wins over an explicit pin", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "proj_platform", PlatformConfig{BootstrapProject: true, ProjectID: "proj_platform"}.ResolvedProjectID())
	})

	t.Run("no bootstrap returns the pin", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "proj_setup", PlatformConfig{ProjectID: "proj_setup"}.ResolvedProjectID())
	})

	t.Run("no bootstrap and no pin is empty", func(t *testing.T) {
		t.Parallel()
		assert.Empty(t, PlatformConfig{}.ResolvedProjectID())
	})
}

func TestPlatformConfigProvisioningProjectID(t *testing.T) {
	t.Parallel()
	t.Run("bootstrap opts into platform provisioning", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "proj_platform", PlatformConfig{BootstrapProject: true}.ProvisioningProjectID())
	})

	// The doctrine under test: a standalone pin names the console's default
	// project, it does not opt the deployment into the platform plane — its
	// end-user registrations must never mint personal teams (#605, #736).
	t.Run("a pin alone does NOT opt in", func(t *testing.T) {
		t.Parallel()
		assert.Empty(t, PlatformConfig{ProjectID: "proj_setup"}.ProvisioningProjectID())
	})

	t.Run("no bootstrap and no pin is empty", func(t *testing.T) {
		t.Parallel()
		assert.Empty(t, PlatformConfig{}.ProvisioningProjectID())
	})
}

func TestTextUnmarshalerDecodeHook(t *testing.T) {
	t.Parallel()

	t.Run("unmarshals LogFormat from string", func(t *testing.T) {
		t.Parallel()
		result, err := textUnmarshalerDecodeHook(reflect.TypeOf(""), reflect.TypeOf(instrumentation.LogFormatText), "json")
		require.NoError(t, err)
		assert.Equal(t, instrumentation.LogFormatJSON, result)
	})

	t.Run("unmarshals LogFormat from string (snake_case)", func(t *testing.T) {
		t.Parallel()
		result, err := textUnmarshalerDecodeHook(reflect.TypeOf(""), reflect.TypeOf(instrumentation.LogFormatGCPErrorReporting), "gcp_error_reporting")
		require.NoError(t, err)
		assert.Equal(t, instrumentation.LogFormatGCPErrorReporting, result)
	})

	t.Run("unmarshals LogFormat from pointer type", func(t *testing.T) {
		t.Parallel()
		var f instrumentation.LogFormat
		result, err := textUnmarshalerDecodeHook(reflect.TypeOf(""), reflect.TypeOf(&f), "text")
		require.NoError(t, err)
		assert.Equal(t, instrumentation.LogFormatText, *result.(*instrumentation.LogFormat))
	})

	t.Run("unmarshals Stream from string", func(t *testing.T) {
		t.Parallel()
		result, err := textUnmarshalerDecodeHook(reflect.TypeOf(""), reflect.TypeOf(zlog.StreamRuntime), "request")
		require.NoError(t, err)
		assert.Equal(t, zlog.StreamRequest, result)
	})

	t.Run("passes through non-string input", func(t *testing.T) {
		t.Parallel()
		result, err := textUnmarshalerDecodeHook(reflect.TypeOf(0), reflect.TypeOf(instrumentation.LogFormatJSON), 3)
		require.NoError(t, err)
		assert.Equal(t, 3, result)
	})

	t.Run("passes through types without TextUnmarshaler", func(t *testing.T) {
		t.Parallel()
		result, err := textUnmarshalerDecodeHook(reflect.TypeOf(""), reflect.TypeOf(""), "hello")
		require.NoError(t, err)
		assert.Equal(t, "hello", result)
	})
}
