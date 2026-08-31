//go:build sqlite_integration

package platform

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
)

const testSchemaBase = "https://example.com/api/schemas"

// newTestProjects wires a real project service over the given pool, which is
// what makes this test worth running: Ensure's whole job is now delegating to
// that service, so a mock would only assert the delegation it already asserts
// in ensure_test.go.
func newTestProjects(t *testing.T, pool *service.DB) (service.ProjectService, service.KeyService) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	masterKeys, err := domain.NewMasterKeys([]domain.MasterKey{
		domain.NewMasterKey("master-key", *key, true),
	})
	require.NoError(t, err)

	schemaValidator, err := domain.NewSchemaValidator(testSchemaBase)
	require.NoError(t, err)

	keys := service.NewKeyService(pool, *masterKeys)
	return service.NewProjectService(pool, testSchemaBase, schemaValidator, keys), keys
}

// TestEnsureSQLiteIdempotent proves the DB-backed idempotency the issue
// requires: running Ensure twice against the same database leaves exactly one
// "Platform" project row and the second run succeeds without error.
func TestEnsureSQLiteIdempotent(t *testing.T) {
	ctx := t.Context()

	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	projectID := domain.PlatformProjectID
	pool := service.NewPool(dbPool)
	projects, _ := newTestProjects(t, pool)

	// First run creates the row.
	require.NoError(t, Ensure(ctx, projects, pool, true))

	created, err := pool.Statements().GetProjectByID(ctx, projectID)
	require.NoError(t, err)
	require.Equal(t, projectID, created.ID)
	require.Equal(t, "Platform", created.Name)

	// Second run is a no-op success; the row is unchanged.
	require.NoError(t, Ensure(ctx, projects, pool, true))

	after, err := pool.Statements().GetProjectByID(ctx, projectID)
	require.NoError(t, err)
	require.Equal(t, projectID, after.ID)
	require.Equal(t, "Platform", after.Name)
	require.Equal(t, created.CreatedAt, after.CreatedAt)
}

// TestEnsureSQLiteSeedsAUsableProject is the point of seeding: a bare project
// row satisfies the foreign keys and nothing else, so a bootstrapped platform
// project could not serve the registration the platform plane exists for. The
// keys, the user schema, and the login flow definitions have to be there.
func TestEnsureSQLiteSeedsAUsableProject(t *testing.T) {
	ctx := t.Context()

	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	projectID := domain.PlatformProjectID
	pool := service.NewPool(dbPool)

	projects, keys := newTestProjects(t, pool)
	require.NoError(t, Ensure(ctx, projects, pool, true))

	// Usable keys, not merely present ones: GetProjectCrypter unwraps the KEK
	// with the master key, which is exactly what the session exchange does
	// before it can mint a token.
	for _, purpose := range []domain.EncryptionKeyPurpose{
		domain.EncryptionKeyPurposeToken,
		domain.EncryptionKeyPurposeSecret,
		domain.EncryptionKeyPurposeCookie,
	} {
		_, err := keys.GetProjectCrypter(ctx, projectID, purpose)
		assert.NoError(t, err, "missing or unusable %s encryption key", purpose)
	}

	// The user schema registrations validate against, read by the exact URL the
	// seeded login flow will reference.
	userSchemaURL := schemas.DefaultHumanUserSchemaURL(testSchemaBase)
	_, err = pool.Statements().GetJSONSchemaByID(ctx, projectID, userSchemaURL)
	assert.NoError(t, err, "a project with no user schema cannot register anyone")

	// The login flows the registration walks through. Their ids are minted at
	// insert, so this counts them against the same defaults the seeding builds
	// from rather than looking one up by a hand-copied id.
	wantFlows, err := flow_definitions.DefaultLoginFlowDefinitions(testSchemaBase, projectID, userSchemaURL)
	require.NoError(t, err)
	require.NotEmpty(t, wantFlows, "the defaults themselves must define a login flow")

	flows, err := pool.Statements().ListFlowDefinitions(
		service.WithAuthzListUnrestricted(ctx),
		&database.ListOptions[domain.FlowDefinitionField]{
			Filter: database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
		})
	require.NoError(t, err)
	assert.Len(t, flows.Items, len(wantFlows), "a project with no login flow cannot serve a sign-in")
}

// TestEnsureSQLiteDisabledCreatesNothing pins the default: no deployment gets a
// platform project, or anything seeded with it, without opting in.
func TestEnsureSQLiteDisabledCreatesNothing(t *testing.T) {
	ctx := t.Context()

	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	pool := service.NewPool(dbPool)
	projects, _ := newTestProjects(t, pool)
	require.NoError(t, Ensure(ctx, projects, pool, false))

	_, err = pool.Statements().GetProjectByID(ctx, domain.PlatformProjectID)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
