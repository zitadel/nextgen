package platform

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestPlatformBundleIsTheServersDefaults(t *testing.T) {
	const builtinBase = "https://example.com/api/schemas"

	bundle, err := platformBundle(builtinBase)
	require.NoError(t, err)

	assert.Equal(t, domain.PlatformProjectID, bundle.ProjectID)
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
