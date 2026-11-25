//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// variableSetFixture is a project with one release and one origin of each
// kind, so a test can create the deployments it stores variables against the
// way the service does. Everything it creates hangs off the project, which
// the cleanup deletes.
type variableSetFixture struct {
	d             dialect
	projectID     string
	releaseID     string
	primaryOrigin string
	previewOrigin string
}

func newVariableSetFixture(t *testing.T, d dialect) *variableSetFixture {
	t.Helper()
	projectID := "proj-vset-" + uniqueSuffix(t)
	require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), projectID) })

	release := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
	return &variableSetFixture{
		d: d, projectID: projectID, releaseID: release.ID,
		primaryOrigin: "https://" + projectID + ".example.test",
		previewOrigin: "https://pr-1-" + projectID + ".example.test",
	}
}

func (f *variableSetFixture) owner() domain.VariableOwner {
	return domain.VariableOwner{ProjectID: f.projectID}
}

// set writes a variable of the project for kind. No cleanup: the project
// delete takes it.
func (f *variableSetFixture) set(t *testing.T, name string, kind domain.DeploymentOriginKind, value any, isSecret bool) {
	t.Helper()
	require.NoError(t, f.d.stmts.SetVariable(t.Context(), &domain.Variable{
		Name: name, Owner: f.owner(), Kind: kind, Value: value, IsSecret: isSecret,
	}))
}

// deploy creates a deployment of the release to the fixture's origin of kind
// and returns its id.
func (f *variableSetFixture) deploy(t *testing.T, kind domain.DeploymentOriginKind) string {
	t.Helper()
	args, origin := deployArgs{kind: kind}, f.primaryOrigin
	if kind == domain.DeploymentOriginKindPreview {
		args, origin = previewDeploy(time.Hour), f.previewOrigin
	}
	return deploy(t, f.d.stmts, f.projectID, f.releaseID, []string{origin}, args).ID
}

// store is what create does. It builds the set from the live rows of kind,
// ensures that set, and links the deployment to its hash.
func (f *variableSetFixture) store(t *testing.T, deploymentID string, kind domain.DeploymentOriginKind) *domain.VariableSet {
	t.Helper()
	variables, err := f.d.stmts.GetVariables(t.Context(), f.owner(), kind)
	require.NoError(t, err)
	set, err := domain.NewVariableSet(f.projectID, variables)
	require.NoError(t, err)
	require.NoError(t, f.d.stmts.EnsureVariableSet(t.Context(), set))
	require.NoError(t, f.d.stmts.LinkDeploymentVariableSet(t.Context(), f.projectID, deploymentID, set.Hash))
	return set
}

func (f *variableSetFixture) get(t *testing.T, deploymentID string) *domain.VariableSet {
	t.Helper()
	set, err := f.d.stmts.GetDeploymentVariables(t.Context(), f.projectID, deploymentID)
	require.NoError(t, err)
	return set
}

// entryValues flattens a set to name → value, which is what most assertions
// here are about.
func entryValues(set *domain.VariableSet) map[string]any {
	values := make(map[string]any, len(set.Entries))
	for _, entry := range set.Entries {
		values[entry.Name] = entry.Value
	}
	return values
}

// The stored set is the rows of the deployment's kind: a primary deployment
// stores the primary values and a preview deployment the preview ones, and a
// name entered for one kind only is absent from the other's set rather than
// inherited by it (ADR 069 §2).
func TestVariableSetStatements_FreezesOneKind(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://api.example.test", false)
		f.set(t, "api_url", domain.DeploymentOriginKindPreview, "https://preview.example.test", false)
		f.set(t, "primary_only", domain.DeploymentOriginKindPrimary, "no preview value", false)

		primary := f.store(t, f.deploy(t, domain.DeploymentOriginKindPrimary), domain.DeploymentOriginKindPrimary)
		assert.Equal(t, map[string]any{
			"api_url":      "https://api.example.test",
			"primary_only": "no preview value",
		}, entryValues(primary))

		preview := f.store(t, f.deploy(t, domain.DeploymentOriginKindPreview), domain.DeploymentOriginKindPreview)
		assert.Equal(t, map[string]any{
			"api_url": "https://preview.example.test",
		}, entryValues(preview), "a preview set holds preview rows only: nothing falls back to the primary value")

		assert.NotEqual(t, primary.Hash, preview.Hash)
	})
}

// The point of freezing: a deployment keeps the values it was created with,
// however the variables change afterwards.
func TestVariableSetStatements_ValuesSurviveLaterChanges(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://v1.example.test", false)
		f.set(t, "legacy_flag", domain.DeploymentOriginKindPrimary, true, false)

		deploymentID := f.deploy(t, domain.DeploymentOriginKindPrimary)
		frozen := f.store(t, deploymentID, domain.DeploymentOriginKindPrimary)

		// The variables move on: one changes, one goes.
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://v2.example.test", false)
		require.NoError(t, d.stmts.DeleteVariable(t.Context(), f.owner(), domain.DeploymentOriginKindPrimary, "legacy_flag"))

		got := f.get(t, deploymentID)
		assert.Equal(t, frozen.Hash, got.Hash)
		assert.Equal(t, map[string]any{
			"api_url":     "https://v1.example.test",
			"legacy_flag": true,
		}, entryValues(got), "the deployment must keep the values it was created with")

		// A deployment created now sees the variables as they are now.
		next := f.store(t, f.deploy(t, domain.DeploymentOriginKindPrimary), domain.DeploymentOriginKindPrimary)
		assert.Equal(t, map[string]any{"api_url": "https://v2.example.test"}, entryValues(next))
	})
}

// A project with no variables still freezes a set, the empty one, so every
// deployment has a set to read: a reader never has to tell "no variables"
// from "not frozen".
func TestVariableSetStatements_EmptySet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)

		deploymentID := f.deploy(t, domain.DeploymentOriginKindPrimary)
		frozen := f.store(t, deploymentID, domain.DeploymentOriginKindPrimary)
		assert.Empty(t, frozen.Entries)

		empty, err := domain.VariableSetHash(nil)
		require.NoError(t, err)
		assert.Equal(t, empty, frozen.Hash)

		got := f.get(t, deploymentID)
		assert.Equal(t, empty, got.Hash)
		assert.Empty(t, got.Entries)
		assert.Equal(t, f.projectID, got.ProjectID)
	})
}

// Sets are content-addressed: two deployments created with the same values
// share one set, and ensuring a set whose hash exists already inserts nothing --
// which is why it does not fail on the set's primary key.
func TestVariableSetStatements_IdenticalValuesShareOneSet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://api.example.test", false)
		f.set(t, "retries", domain.DeploymentOriginKindPrimary, 3, false)

		first := f.deploy(t, domain.DeploymentOriginKindPrimary)
		second := f.deploy(t, domain.DeploymentOriginKindPrimary)
		firstSet := f.store(t, first, domain.DeploymentOriginKindPrimary)
		secondSet := f.store(t, second, domain.DeploymentOriginKindPrimary)

		assert.Equal(t, firstSet.Hash, secondSet.Hash, "unchanged values must resolve to the set that already exists")
		assert.Equal(t, firstSet.Entries, secondSet.Entries)
		assert.Equal(t, f.get(t, first), f.get(t, second))

		// A change is a new set; the earlier deployments keep the old one.
		f.set(t, "retries", domain.DeploymentOriginKindPrimary, 5, false)
		third := f.store(t, f.deploy(t, domain.DeploymentOriginKindPrimary), domain.DeploymentOriginKindPrimary)
		assert.NotEqual(t, firstSet.Hash, third.Hash)
		assert.Equal(t, firstSet.Hash, f.get(t, first).Hash)
		assert.Equal(t, firstSet.Hash, f.get(t, second).Hash)

		// Rolling back is freezing the old values again: the old set is
		// reused, not re-created.
		f.set(t, "retries", domain.DeploymentOriginKindPrimary, 3, false)
		rollback := f.store(t, f.deploy(t, domain.DeploymentOriginKindPrimary), domain.DeploymentOriginKindPrimary)
		assert.Equal(t, firstSet.Hash, rollback.Hash)
	})
}

// What a dialect stores and reads back must still hash to the stored hash:
// the number comes back as the float64 the JSON column holds, and a secret
// as the identical ciphertext, never decrypted and re-encrypted.
func TestVariableSetStatements_RoundTripRehashes(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		const ciphertext = "eyJhbGciOiJBMjU2R0NNS1ciLCJraWQiOiJrZXktMSJ9.encrypted.value"
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://api.example.test", false)
		f.set(t, "client_secret", domain.DeploymentOriginKindPrimary, ciphertext, true)
		f.set(t, "retries", domain.DeploymentOriginKindPrimary, 3, false)
		f.set(t, "verbose", domain.DeploymentOriginKindPrimary, true, false)

		deploymentID := f.deploy(t, domain.DeploymentOriginKindPrimary)
		frozen := f.store(t, deploymentID, domain.DeploymentOriginKindPrimary)
		got := f.get(t, deploymentID)

		// The entries come back sorted by name, in three different JSON
		// representations -- JSONB, Spanner JSON and a TEXT column.
		assert.Equal(t, []domain.VariableSetEntry{
			{Name: "api_url", Value: "https://api.example.test"},
			{Name: "client_secret", Value: ciphertext, IsSecret: true},
			{Name: "retries", Value: float64(3)},
			{Name: "verbose", Value: true},
		}, got.Entries)
		assert.Equal(t, frozen.Entries, got.Entries, "what store returns is what Get reads back")

		rehashed, err := domain.VariableSetHash(got.Entries)
		require.NoError(t, err)
		assert.Equal(t, got.Hash, rehashed, "the stored set must still hash to the stored hash")
		assert.Equal(t, frozen.Hash, got.Hash)
	})
}

func TestVariableSetStatements_Errors(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://api.example.test", false)

		t.Run("linking a deployment twice is a UniqueError", func(t *testing.T) {
			deploymentID := f.deploy(t, domain.DeploymentOriginKindPrimary)
			set := f.store(t, deploymentID, domain.DeploymentOriginKindPrimary)

			err := d.stmts.LinkDeploymentVariableSet(t.Context(), f.projectID, deploymentID, set.Hash)
			assert.ErrorIs(t, err, new(database.UniqueError), "a deployment runs with one set, for good")
		})

		// The set row exists. The deployment does not, so the link's
		// deployment key is what fails.
		t.Run("linking an unknown deployment is a ForeignKeyError", func(t *testing.T) {
			set, err := domain.NewVariableSet(f.projectID, nil)
			require.NoError(t, err)
			require.NoError(t, d.stmts.EnsureVariableSet(t.Context(), set))

			err = d.stmts.LinkDeploymentVariableSet(t.Context(), f.projectID, "dep-does-not-exist", set.Hash)
			assert.ErrorIs(t, err, new(database.ForeignKeyError))
		})

		t.Run("reading a deployment that was never frozen is a NoRowFoundError", func(t *testing.T) {
			deploymentID := f.deploy(t, domain.DeploymentOriginKindPrimary)

			_, err := d.stmts.GetDeploymentVariables(t.Context(), f.projectID, deploymentID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))

			_, err = d.stmts.GetDeploymentVariables(t.Context(), f.projectID, "dep-does-not-exist")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

// Sets are per project: a project freezes and reads its own values only, and
// the same values in two projects are two sets.
func TestVariableSetStatements_ProjectIsolation(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		one := newVariableSetFixture(t, d)
		other := newVariableSetFixture(t, d)
		one.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://one.example.test", false)
		other.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://other.example.test", false)

		oneDeployment := one.deploy(t, domain.DeploymentOriginKindPrimary)
		otherDeployment := other.deploy(t, domain.DeploymentOriginKindPrimary)
		assert.Equal(t, map[string]any{"api_url": "https://one.example.test"}, entryValues(one.store(t, oneDeployment, domain.DeploymentOriginKindPrimary)))
		assert.Equal(t, map[string]any{"api_url": "https://other.example.test"}, entryValues(other.store(t, otherDeployment, domain.DeploymentOriginKindPrimary)))

		t.Run("a deployment is addressed through its own project", func(t *testing.T) {
			_, err := d.stmts.GetDeploymentVariables(t.Context(), other.projectID, oneDeployment)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))

			set, err := domain.NewVariableSet(other.projectID, nil)
			require.NoError(t, err)
			require.NoError(t, d.stmts.EnsureVariableSet(t.Context(), set))
			err = d.stmts.LinkDeploymentVariableSet(t.Context(), other.projectID, oneDeployment, set.Hash)
			assert.ErrorIs(t, err, new(database.ForeignKeyError), "a deployment of one project cannot be linked under another")
		})

		// The same values in two projects hash the same and are still two
		// rows, one per project: the set key is the project plus the hash.
		// Observable through the statements by deleting one project: its
		// cascade takes its own set, and the other project's deployment still
		// reads the set it froze, under the same hash and its own project.
		t.Run("identical values in two projects are two sets", func(t *testing.T) {
			one.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://shared.example.test", false)
			other.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://shared.example.test", false)

			oneSet := one.store(t, one.deploy(t, domain.DeploymentOriginKindPrimary), domain.DeploymentOriginKindPrimary)
			otherDeployment := other.deploy(t, domain.DeploymentOriginKindPrimary)
			otherSet := other.store(t, otherDeployment, domain.DeploymentOriginKindPrimary)
			assert.Equal(t, oneSet.Hash, otherSet.Hash)
			assert.Equal(t, one.projectID, oneSet.ProjectID)
			assert.Equal(t, other.projectID, otherSet.ProjectID)

			_, err := d.stmts.DeleteProjectByID(t.Context(), one.projectID)
			require.NoError(t, err)

			got := other.get(t, otherDeployment)
			assert.Equal(t, otherSet.Hash, got.Hash, "the other project's set must survive the first project's delete")
			assert.Equal(t, other.projectID, got.ProjectID)
			assert.Equal(t, map[string]any{"api_url": "https://shared.example.test"}, entryValues(got))
		})
	})
}

// Deleting a project takes its sets and links with it. This is the guard for
// the cascade order on Postgres: the link's NO ACTION key to the set would
// abort the delete if the links were only removed through the deployment
// cascade, a level further down, after the sets are gone at the first.
func TestVariableSetStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://api.example.test", false)
		f.set(t, "api_url", domain.DeploymentOriginKindPreview, "https://preview.example.test", false)
		primary := f.deploy(t, domain.DeploymentOriginKindPrimary)
		preview := f.deploy(t, domain.DeploymentOriginKindPreview)
		f.store(t, primary, domain.DeploymentOriginKindPrimary)
		f.store(t, preview, domain.DeploymentOriginKindPreview)

		_, err := d.stmts.DeleteProjectByID(t.Context(), f.projectID)
		require.NoError(t, err, "a project with frozen deployments must still be deletable")

		_, err = d.stmts.GetDeploymentVariables(t.Context(), f.projectID, primary)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetDeploymentVariables(t.Context(), f.projectID, preview)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		variables, err := d.stmts.GetVariables(t.Context(), f.owner(), domain.DeploymentOriginKindPrimary)
		require.NoError(t, err)
		assert.Empty(t, variables)
	})
}

// The link insert is SQL in the same transaction as CreateDeployment, before
// that transaction commits. A link after CreateDeployment returns does not
// prove it: that insert runs against a committed row. Spanner SQL cannot see
// a buffered mutation, so the deployment insert is DML.
func TestVariableSetStatements_LinkSeesTheDeploymentItFollows(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://api.example.test", false)

		var deploymentID string
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			stmts := tx.Statements()
			entity, err := domain.NewDeployment(f.projectID, f.releaseID, domain.DeploymentOriginKindPrimary, []string{f.primaryOrigin}, domain.DeploymentMetadata{Reason: domain.DeploymentReasonDeploy})
			if err != nil {
				return err
			}
			serving, err := stmts.GetNewestPerOrigin(ctx, f.projectID, entity.Origins())
			if err != nil {
				return err
			}
			if err := stmts.CreateDeployment(ctx, entity, serving); err != nil {
				return err
			}
			variables, err := stmts.GetVariables(ctx, f.owner(), domain.DeploymentOriginKindPrimary)
			if err != nil {
				return err
			}
			set, err := domain.NewVariableSet(f.projectID, variables)
			if err != nil {
				return err
			}
			if err := stmts.EnsureVariableSet(ctx, set); err != nil {
				return err
			}
			if err := stmts.LinkDeploymentVariableSet(ctx, f.projectID, entity.ID, set.Hash); err != nil {
				return err
			}
			deploymentID = entity.ID
			return nil
		})
		require.NoError(t, err)

		assert.Equal(t, map[string]any{"api_url": "https://api.example.test"}, entryValues(f.get(t, deploymentID)))
	})
}

// A rollback links the restored deployment's set. The new deployment keeps
// those values after the live rows move on, and it does not write a set of its own.
func TestVariableSetStatements_LinkReusesAnExistingSet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://v1.example.test", false)

		first := f.deploy(t, domain.DeploymentOriginKindPrimary)
		frozen := f.store(t, first, domain.DeploymentOriginKindPrimary)

		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://v2.example.test", false)
		second := f.deploy(t, domain.DeploymentOriginKindPrimary)
		require.NoError(t, d.stmts.LinkDeploymentVariableSet(t.Context(), f.projectID, second, frozen.Hash))

		got := f.get(t, second)
		assert.Equal(t, frozen.Hash, got.Hash)
		assert.Equal(t, map[string]any{"api_url": "https://v1.example.test"}, entryValues(got))
		assert.Equal(t, map[string]any{"api_url": "https://v2.example.test"}, entryValues(f.store(t, f.deploy(t, domain.DeploymentOriginKindPrimary), domain.DeploymentOriginKindPrimary)), "a deployment stored now holds the live rows")

		err := d.stmts.LinkDeploymentVariableSet(t.Context(), f.projectID, second, frozen.Hash)
		assert.ErrorIs(t, err, new(database.UniqueError), "a deployment links one set")

		third := f.deploy(t, domain.DeploymentOriginKindPrimary)
		err = d.stmts.LinkDeploymentVariableSet(t.Context(), f.projectID, third, strings.Repeat("ab", 32))
		assert.ErrorIs(t, err, new(database.ForeignKeyError), "the set has to exist already")
	})
}

// Ensure stores the set it is given. Changing the live variable afterwards
// leaves a deployment linked to that hash on the ensured values.
func TestVariableSetStatements_EnsureKeepsTheSetItWasGiven(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableSetFixture(t, d)
		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://v1.example.test", false)
		variable, err := domain.NewVariable("api_url", f.owner(), "https://v1.example.test")
		require.NoError(t, err)
		set, err := domain.NewVariableSet(f.projectID, []*domain.Variable{variable})
		require.NoError(t, err)
		require.NoError(t, d.stmts.EnsureVariableSet(t.Context(), set))
		require.NoError(t, d.stmts.EnsureVariableSet(t.Context(), set), "a hash that already exists is success")

		f.set(t, "api_url", domain.DeploymentOriginKindPrimary, "https://v2.example.test", false)
		deploymentID := f.deploy(t, domain.DeploymentOriginKindPrimary)
		require.NoError(t, d.stmts.LinkDeploymentVariableSet(t.Context(), f.projectID, deploymentID, set.Hash))

		got := f.get(t, deploymentID)
		assert.Equal(t, set.Hash, got.Hash)
		assert.Equal(t, map[string]any{"api_url": "https://v1.example.test"}, entryValues(got))
	})
}
