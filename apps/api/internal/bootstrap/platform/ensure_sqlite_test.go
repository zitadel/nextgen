//go:build sqlite_integration

package platform

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/cache"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
	"github.com/zitadel/oidc/v3/pkg/op"
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

	// bcrypt at cost 10, bounded 10..16: this test is about Ensure, not about
	// hashing, but the project service needs the deployment's hashing
	// configuration to answer whether a project may pick a method of its own.
	hashers, err := (&crypto.HashConfig{
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
		Hasher: crypto.HasherConfig{
			Algorithm: crypto.HashNameBcrypt,
			Params:    map[string]any{"cost": 10},
		},
		Limits: crypto.HashLimitsConfig{
			Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16},
		},
	}).NewHasherFactory()
	require.NoError(t, err)

	crypters, err := cache.NewMeteredLRU[service.CrypterCacheKey, op.Crypto](cache.NameCrypter, 64)
	require.NoError(t, err)
	signingKeys, err := cache.NewMeteredLRU[service.SigningKeyCacheKey, domain.SigningKey](cache.NameSigningKey, 64)
	require.NoError(t, err)

	keys := service.NewKeyService(pool, *masterKeys, crypters, signingKeys)
	return service.NewProjectService(pool, testSchemaBase, schemaValidator, keys, hashers, domain.DefaultSharedHosts), keys
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

// TestEnsureSQLiteCreatesTheProjectWithUsableKeys: the keys are what a
// session exchange needs before it can mint a token. The user schema and the
// login flows are not seeded here: they are the release EnsureDeployed builds.
func TestEnsureSQLiteCreatesTheProjectWithUsableKeys(t *testing.T) {
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

	flows, err := pool.Statements().ListFlowDefinitions(
		service.WithAuthzListUnrestricted(ctx),
		&database.ListOptions[domain.FlowDefinitionField]{
			Filter: database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
		}, service.FlowDefinitionQueryOptions{})
	require.NoError(t, err)
	assert.Empty(t, flows.Items, "the login flows arrive with the release, not with the project")
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
