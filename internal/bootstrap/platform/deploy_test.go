package platform

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestDeployedByNewerBuild(t *testing.T) {
	earlier := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	later := earlier.Add(time.Hour)
	primary := func(message string) *domain.Deployment {
		return &domain.Deployment{OriginKind: domain.DeploymentOriginKindPrimary, Metadata: domain.DeploymentMetadata{Message: &message}}
	}
	builtAt := func(when time.Time) string { return platformDeployPrefix + when.Format(time.RFC3339) }
	preview := &domain.Deployment{OriginKind: domain.DeploymentOriginKindPreview}
	defaultOnly := &domain.Deployment{
		OriginKind: domain.DeploymentOriginKindPrimary,
		Targets:    []domain.DeploymentTarget{{Origin: domain.DefaultTargetOrigin}},
	}

	for _, tt := range []struct {
		name string
		live []*domain.Deployment
		own  time.Time
		want bool
	}{
		{"nothing is live", nil, earlier, false},
		{"a later build is live", []*domain.Deployment{primary(builtAt(later))}, earlier, true},
		{"the same build is live", []*domain.Deployment{primary(builtAt(earlier))}, earlier, false},
		{"an earlier build is live", []*domain.Deployment{primary(builtAt(earlier))}, later, false},
		{"a development build always deploys", []*domain.Deployment{primary(builtAt(later))}, time.Time{}, false},
		{"a release replaces a development build", []*domain.Deployment{primary(builtAt(time.Time{}))}, earlier, false},
		{"a deployment of someone else's says nothing", []*domain.Deployment{primary("by hand")}, earlier, false},
		{"a preview is not what the console is served", []*domain.Deployment{preview, primary(builtAt(later))}, earlier, true},
		{"nor is a deployment to the default target alone", []*domain.Deployment{defaultOnly, primary(builtAt(later))}, earlier, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, deployedByNewerBuild(tt.live, tt.own))
		})
	}
}

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
