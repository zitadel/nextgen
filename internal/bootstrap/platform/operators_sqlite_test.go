//go:build sqlite_integration

package platform

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
)

// TestReconcileOperatorsSQLite walks the configuration through the changes an
// operator of a deployment makes: naming operators, naming one who has not
// signed up yet, dropping one, and restarting with nothing changed.
func TestReconcileOperatorsSQLite(t *testing.T) {
	ctx := t.Context()

	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	pool := service.NewPool(dbPool)
	stmts := pool.Statements()

	const platform = "proj_ops_platform"
	const schemaURL = "https://example.com/schemas/operator"
	require.NoError(t, stmts.CreateProject(ctx, &domain.Project{ID: platform, Name: "Platform", Origins: []domain.Origin{}}))
	require.NoError(t, stmts.CreateJSONSchema(ctx, &domain.JSONSchema{ProjectID: platform, URL: schemaURL, Schema: []byte(`{"type":"object"}`)}))
	for _, id := range []string{"user_alice", "user_bob", "user_carol"} {
		name, err := domain.NewCreateAttribute("name", id, domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		require.NoError(t, stmts.CreateUser(ctx, &domain.CreateUser{
			ProjectID: platform, SchemaURL: schemaURL, ID: id,
			Attributes: []domain.CreateAttribute{*name},
		}))
	}

	operators := func() []string {
		t.Helper()
		active, err := stmts.ListActiveAuthzAssignmentsByRelation(ctx, platform, domain.AuthzObjectTypePlatform, domain.AuthzRelationOperator)
		require.NoError(t, err)
		ids := make([]string, 0, len(active))
		for _, a := range active {
			ids = append(ids, a.PrincipalID)
		}
		return ids
	}
	events := func(typ domain.EventType) int {
		t.Helper()
		listed, err := stmts.ListEvents(ctx, &database.ListOptions[domain.EventField]{
			Filter: database.And(
				database.Equal(database.Col(domain.EventFieldProjectID), platform),
				database.Equal(database.Col(domain.EventFieldEventType), string(typ)),
			),
		})
		require.NoError(t, err)
		for _, ev := range listed.Items {
			require.NotNil(t, ev.ActorType)
			assert.Equal(t, domain.EventActorTypeSystem, *ev.ActorType, "configuration, not a request, made the change")
		}
		return len(listed.Items)
	}

	t.Run("grants the listed users that exist", func(t *testing.T) {
		require.NoError(t, ReconcileOperators(ctx, pool, platform, []string{"user_alice", "user_bob", "user_nobody"}))
		assert.ElementsMatch(t, []string{"user_alice", "user_bob"}, operators())
		assert.Equal(t, 2, events(domain.EventTypeAuthzGranted))
	})

	t.Run("a restart with the same list changes nothing", func(t *testing.T) {
		require.NoError(t, ReconcileOperators(ctx, pool, platform, []string{"user_alice", "user_bob", "user_nobody"}))
		assert.ElementsMatch(t, []string{"user_alice", "user_bob"}, operators())
		assert.Equal(t, 2, events(domain.EventTypeAuthzGranted))
	})

	t.Run("dropping a user revokes what configuration granted", func(t *testing.T) {
		require.NoError(t, ReconcileOperators(ctx, pool, platform, []string{"user_alice"}))
		assert.ElementsMatch(t, []string{"user_alice"}, operators())
		assert.Equal(t, 1, events(domain.EventTypeAuthzRevoked))
	})

	t.Run("an operator granted any other way is left alone", func(t *testing.T) {
		other := domain.NewPlatformOperatorAssignment(platform, "user_carol")
		other.GrantorType = nil
		require.NoError(t, stmts.CreateAuthzAssignment(ctx, other))

		require.NoError(t, ReconcileOperators(ctx, pool, platform, nil))
		assert.ElementsMatch(t, []string{"user_carol"}, operators())
		assert.Equal(t, 2, events(domain.EventTypeAuthzRevoked))
	})

	t.Run("a deployment without a platform project has nothing to reconcile", func(t *testing.T) {
		require.NoError(t, ReconcileOperators(ctx, pool, "", []string{"user_alice"}))
		assert.ElementsMatch(t, []string{"user_carol"}, operators())
	})
}
