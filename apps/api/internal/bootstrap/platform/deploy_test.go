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
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, deployedByNewerBuild(tt.live, tt.own))
		})
	}
}

// What a server that does not seed reports when it starts.
func TestDrift(t *testing.T) {
	const origin = "https://console.example"
	earlier := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	later := earlier.Add(time.Hour)
	primary := func(builtAt time.Time, origins ...string) *domain.Deployment {
		message := platformDeployPrefix + builtAt.Format(time.RFC3339)
		deployment := &domain.Deployment{OriginKind: domain.DeploymentOriginKindPrimary, Metadata: domain.DeploymentMetadata{Message: &message}}
		for _, origin := range origins {
			deployment.Targets = append(deployment.Targets, domain.DeploymentTarget{Origin: origin})
		}
		return deployment
	}
	byHand := primary(earlier, origin)
	byHand.Metadata.Message = nil
	preview := &domain.Deployment{OriginKind: domain.DeploymentOriginKindPreview, Targets: []domain.DeploymentTarget{{Origin: origin}}}
	listed := []domain.Origin{{Pattern: origin, Kind: domain.OriginKindPrimary}}

	for _, tt := range []struct {
		name     string
		origins  []domain.Origin
		live     []*domain.Deployment
		builtAt  time.Time
		breaking []bool
	}{
		{"what this server's seeding left", listed, []*domain.Deployment{primary(earlier, origin)}, earlier, nil},
		{"a newer server's seeding is left alone", listed, []*domain.Deployment{primary(later, origin)}, earlier, nil},
		{"a deployment someone made by hand", listed, []*domain.Deployment{byHand}, later, nil},
		{"a development build has no age", listed, []*domain.Deployment{primary(earlier, origin)}, time.Time{}, nil},
		{"an older server's configuration", listed, []*domain.Deployment{primary(earlier, origin)}, later, []bool{false}},
		{"nothing is deployed", listed, nil, earlier, []bool{true}},
		{"only a preview is deployed", listed, []*domain.Deployment{preview}, earlier, []bool{true}},
		{"another public base was seeded", listed, []*domain.Deployment{primary(earlier, "https://other.example")}, earlier, []bool{true}},
		{"the origin was removed after the seeding", nil, []*domain.Deployment{primary(earlier, origin)}, earlier, []bool{true}},
		{"the origin is only a preview's", []domain.Origin{{Pattern: origin, Kind: domain.OriginKindPreview}}, []*domain.Deployment{primary(earlier, origin)}, earlier, []bool{true}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var breaking []bool
			for _, found := range drift(tt.origins, tt.live, tt.builtAt, origin) {
				breaking = append(breaking, found.Breaking)
				assert.NotEmpty(t, found.Message)
			}
			assert.Equal(t, tt.breaking, breaking)
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

	require.Len(t, bundle.Policies, 2, "the recommended password policy and the default sign-up policy")
	assert.Equal(t, "auth.factor.password.set", bundle.Policies[0].Operation)
	assert.InDelta(t, 15, bundle.Policies[0].Config["min_length"], 0)
	assert.Equal(t, "user.create", bundle.Policies[1].Operation)
	assert.Equal(t, map[string]any{"challenge": domain.SignupGateProvider}, bundle.Policies[1].Config)
}
