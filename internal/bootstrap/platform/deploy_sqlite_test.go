//go:build sqlite_integration

package platform

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
)

// consoleOrigin is where the console runs in these tests.
const consoleOrigin = "https://console.example.com"

// testBuild is when the server in these tests was built.
var testBuild = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

// TestEnsureDeployedSQLiteServesTheServersBundle runs the start-up bootstrap
// against real services: the release the server's bundle builds into carries
// the platform user schema and the default login flows, it is live on the
// console origin, and a restart that changes nothing deploys nothing.
func TestEnsureDeployedSQLiteServesTheServersBundle(t *testing.T) {
	ctx := t.Context()
	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	pool := service.NewPool(dbPool)
	projects, keys := newTestProjects(t, pool)
	releases, deployments := newTestReleases(t, pool, keys)
	require.NoError(t, Ensure(ctx, projects, pool, true))

	deploy := func() {
		t.Helper()
		require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild, consoleOrigin, projects, releases, deployments))
	}
	served := func() []domain.OriginDeployment {
		t.Helper()
		read, err := pool.Statements().GetNewestPerOrigin(ctx, domain.PlatformProjectID,
			[]string{consoleOrigin, domain.DefaultTargetOrigin})
		require.NoError(t, err)
		return read
	}

	deploy()
	first := served()
	require.Len(t, first, 2, "the console origin and the default target are served")
	assert.Equal(t, first[0].DeploymentID, first[1].DeploymentID, "one deployment serves both")
	deploy()
	assert.Equal(t, first, served(), "a restart that changes nothing deploys nothing")

	release, err := releases.Get(ctx, domain.PlatformProjectID, first[0].ReleaseID)
	require.NoError(t, err)
	kinds := map[domain.ReleasePointerKind]int{}
	schemaID := ""
	for _, pointer := range release.Pointers {
		kinds[pointer.Kind]++
		if pointer.Kind == domain.ReleasePointerKindSchema {
			schemaID = pointer.RevisionID
		}
	}
	assert.Equal(t, 1, kinds[domain.ReleasePointerKindSchema], "the platform user schema")
	assert.Positive(t, kinds[domain.ReleasePointerKindFlowDefinition], "the default login flows")
	assert.Equal(t, 1, kinds[domain.ReleasePointerKindPolicy], "the recommended password policy")

	// The project starts empty: everything it serves came with the release.
	flows, err := pool.Statements().ListFlowDefinitions(
		service.WithAuthzListUnrestricted(ctx),
		&database.ListOptions[domain.FlowDefinitionField]{
			Filter: database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), domain.PlatformProjectID),
		}, service.FlowDefinitionQueryOptions{})
	require.NoError(t, err)
	assert.Len(t, flows.Items, kinds[domain.ReleasePointerKindFlowDefinition])

	// Stored under an id the build minted, as for any project's schema, and the
	// platform variant, not the default (its shape is pinned in
	// platform_schema_test.go).
	assert.True(t, strings.HasPrefix(schemaID, "sch_"), schemaID)
	userSchema, err := pool.Statements().GetJSONSchemaByID(ctx, domain.PlatformProjectID, schemaID)
	require.NoError(t, err)
	assert.Equal(t, []string{schemas.PlatformDisplayNameProperty}, domain.DesignatedDisplay(userSchema.Schema))
}

// A server built before the one that made the live deployment leaves the
// project alone, even when it was started with another public base.
func TestEnsureDeployedSQLiteOlderBuildLeavesTheProjectAlone(t *testing.T) {
	ctx := t.Context()
	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	pool := service.NewPool(dbPool)
	projects, keys := newTestProjects(t, pool)
	releases, deployments := newTestReleases(t, pool, keys)
	require.NoError(t, Ensure(ctx, projects, pool, true))
	require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild, consoleOrigin, projects, releases, deployments))

	require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild.Add(-time.Hour), "https://old.example.com", projects, releases, deployments))

	project, err := projects.Get(ctx, domain.PlatformProjectID, service.ProjectQueryOptions{})
	require.NoError(t, err)
	assert.Equal(t, []domain.Origin{{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary}}, project.Origins)
}

// Content someone revoked builds back to that release, which cannot be
// deployed. The server starts all the same, and what serves keeps serving.
func TestEnsureDeployedSQLiteStartsWhenItsContentIsRevoked(t *testing.T) {
	ctx := t.Context()
	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	pool := service.NewPool(dbPool)
	projects, keys := newTestProjects(t, pool)
	releases, deployments := newTestReleases(t, pool, keys)
	require.NoError(t, Ensure(ctx, projects, pool, true))
	require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild, consoleOrigin, projects, releases, deployments))

	read, err := pool.Statements().GetNewestPerOrigin(ctx, domain.PlatformProjectID, []string{consoleOrigin})
	require.NoError(t, err)
	revoked, err := releases.Get(ctx, domain.PlatformProjectID, read[0].ReleaseID)
	require.NoError(t, err)
	var withoutPolicy []service.CreateReleasePointer
	for _, pointer := range revoked.Pointers {
		if pointer.Kind != domain.ReleasePointerKindPolicy {
			withoutPolicy = append(withoutPolicy, service.CreateReleasePointer{Kind: pointer.Kind, RevisionID: pointer.RevisionID})
		}
	}
	other, err := releases.Create(ctx, service.CreateReleaseInput{ProjectID: domain.PlatformProjectID, Pointers: withoutPolicy})
	require.NoError(t, err)
	_, err = deployments.Deploy(ctx, service.DeployInput{
		ProjectID: domain.PlatformProjectID,
		ReleaseID: other.Release.ID,
		Targets:   []string{domain.DeploymentTargetPrimary, domain.DeploymentTargetDefault},
		Reason:    domain.DeploymentReasonDeploy,
	})
	require.NoError(t, err)
	_, err = releases.Revoke(ctx, domain.PlatformProjectID, revoked.ID)
	require.NoError(t, err)

	require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild, consoleOrigin, projects, releases, deployments))
}

// Every start leaves public_base's origin the one primary origin, so a public
// base the deployment has left is no longer admitted. Preview origins stay.
func TestEnsureDeployedSQLiteOwnsThePrimaryOrigins(t *testing.T) {
	ctx := t.Context()
	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	pool := service.NewPool(dbPool)
	projects, keys := newTestProjects(t, pool)
	releases, deployments := newTestReleases(t, pool, keys)
	require.NoError(t, Ensure(ctx, projects, pool, true))

	const preview = "https://*-console.example.com"
	require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild, "https://old.example.com", projects, releases, deployments))
	_, err = projects.AddOrigin(ctx, domain.PlatformProjectID, domain.Origin{Pattern: preview, Kind: domain.OriginKindPreview})
	require.NoError(t, err)

	require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild, consoleOrigin, projects, releases, deployments))

	project, err := projects.Get(ctx, domain.PlatformProjectID, service.ProjectQueryOptions{})
	require.NoError(t, err)
	assert.ElementsMatch(t, []domain.Origin{
		{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary},
		{Pattern: preview, Kind: domain.OriginKindPreview},
	}, project.Origins)
}

// conflictOnce is a release service whose first build loses the race another
// replica won, the way a concurrent start does.
type conflictOnce struct {
	service.ReleaseService
	lost bool
}

func (s *conflictOnce) Build(ctx context.Context, input service.BuildReleaseInput) (*service.CreateReleaseOutput, error) {
	if !s.lost {
		s.lost = true
		return nil, domain.ErrPolicyRevisionConflict()
	}
	return s.ReleaseService.Build(ctx, input)
}

// A replica that loses the race to store the revisions still starts: its second
// build finds what the winner stored.
func TestEnsureDeployedSQLiteRetriesALostBuild(t *testing.T) {
	ctx := t.Context()
	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	pool := service.NewPool(dbPool)
	projects, keys := newTestProjects(t, pool)
	releases, deployments := newTestReleases(t, pool, keys)
	require.NoError(t, Ensure(ctx, projects, pool, true))

	losing := &conflictOnce{ReleaseService: releases}
	require.NoError(t, EnsureDeployed(ctx, testSchemaBase, testBuild, consoleOrigin, projects, losing, deployments))
	assert.True(t, losing.lost)
}

// newTestReleases wires the release and deployment services the way the
// server does, over the given pool.
func newTestReleases(t *testing.T, pool *service.DB, keys service.KeyService) (service.ReleaseService, *service.DeploymentService) {
	t.Helper()
	base, err := url.Parse(testSchemaBase)
	require.NoError(t, err)
	cache, err := lru.New2Q[string, *jsonschema.Schema](64)
	require.NoError(t, err)
	validator, err := domain.NewSchemaValidator(testSchemaBase)
	require.NoError(t, err)
	bases := domain.BuiltinSchemaBasesFor(testSchemaBase)
	engine, err := policy.New()
	require.NoError(t, err)

	schemaService := service.NewSchemaService(pool, domain.NewJSONSchemaResolver(cache, 10, 0, nil, base), validator, bases)
	releases := service.NewReleaseService(
		pool,
		schemaService,
		service.NewFlowDefinitionService(pool, validator, nil, bases),
		service.NewBrandingService(pool),
		service.NewIDPConnectionService(pool, validator),
		service.NewPolicyService(pool, engine),
		bases,
	)
	return releases, service.NewDeploymentService(pool, service.NewVariableService(pool, keys))
}
