package platform

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestNewerVersion(t *testing.T) {
	for _, tt := range []struct {
		name string
		live string
		own  string
		want bool
	}{
		{"a later release", "0.4.0", "0.3.0", true},
		{"the same release", "0.3.0", "0.3.0", false},
		{"an earlier release", "0.2.0", "0.3.0", false},
		{"a release after its prerelease", "0.3.0", "0.3.0-alpha.1", true},
		{"a development build always deploys", "0.3.0", "dev", false},
		{"a release replaces a development build", "dev", "0.3.0", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, newerVersion(tt.live, tt.own))
		})
	}
}

func TestPlatformBundleIsTheServersDefaults(t *testing.T) {
	const builtinBase = "https://example.com/api/schemas"

	bundle, err := platformBundle(builtinBase, "1.2.3")
	require.NoError(t, err)

	assert.Equal(t, domain.PlatformProjectID, bundle.ProjectID)
	require.NotNil(t, bundle.Message)
	assert.Equal(t, platformReleasePrefix+"1.2.3", *bundle.Message)
	require.Len(t, bundle.Schemas, 1, "the platform user schema")
	assert.False(t, domain.SchemaDocumentHasTopLevelID(bundle.Schemas[0].Document), "a bundled schema carries no $id")

	defaults, err := flow_definitions.DefaultLoginFlowDefinitions(builtinBase, domain.PlatformProjectID)
	require.NoError(t, err)
	require.Len(t, bundle.FlowDefinitions, len(defaults), "the default login flows")
	for i, flow := range bundle.FlowDefinitions {
		assert.Equal(t, defaults[i].Name, flow.Request.Name)
	}

	require.Len(t, bundle.Policies, 1, "the recommended password policy")
	assert.Equal(t, "auth.factor.password.set", bundle.Policies[0].Operation)
	assert.InDelta(t, 15, bundle.Policies[0].Config["min_length"], 0)
}
