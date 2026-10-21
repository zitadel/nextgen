//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const testPolicyOperation = "auth.factor.password.set"

func createPolicy(t *testing.T, stmts service.AllStatements, projectID, operation, config string) *domain.Policy {
	t.Helper()
	entity := &domain.Policy{ProjectID: projectID, Operation: operation, Config: []byte(config)}
	require.NoError(t, stmts.CreatePolicy(t.Context(), entity))
	return entity
}

func TestPolicyStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		config := `{"min_length":12}`

		entity := createPolicy(t, d.stmts, projectID, testPolicyOperation, config)

		// The dialect mints both ids (ADR 047), each with its own prefix.
		assert.True(t, domain.PrefixPolicy.Matches(entity.ID), "id %q is not pol_-prefixed", entity.ID)
		assert.True(t, domain.PrefixPolicyRevision.Matches(entity.RevisionID), "revision id %q is not polrev_-prefixed", entity.RevisionID)
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
		assert.True(t, entity.CreatedAt.Equal(entity.UpdatedAt), "a policy nobody revised must not look edited")

		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindPolicy, projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, projectID, scope.ProjectID)

		got, err := d.stmts.GetPolicy(t.Context(), projectID, testPolicyOperation)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, entity.RevisionID, got.RevisionID)
		assert.Equal(t, testPolicyOperation, got.Operation)
		// Spanner re-serializes JSON, so compare JSON rather than bytes.
		assert.JSONEq(t, config, string(got.Config))
		assert.True(t, got.UpdatedAt.Equal(entity.UpdatedAt), "create must report the timestamp a read serves")

		revision, err := d.stmts.GetPolicyRevision(t.Context(), projectID, entity.RevisionID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, revision.ID)
		assert.JSONEq(t, config, string(revision.Config))
	})
}

// A project has one policy per operation: a second create of the same
// operation is a *database.UniqueError, and the service publishes on top of
// the first instead.
func TestPolicyStatements_OperationUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		createPolicy(t, d.stmts, projectID, testPolicyOperation, `{}`)

		err := d.stmts.CreatePolicy(t.Context(), &domain.Policy{ProjectID: projectID, Operation: testPolicyOperation, Config: []byte(`{}`)})
		assert.ErrorIs(t, err, new(database.UniqueError))

		other := createPolicy(t, d.stmts, ensureProject(t, d.stmts), testPolicyOperation, `{}`)
		assert.NotEmpty(t, other.ID, "another project may have its own policy for the operation")
	})
}

// Revising appends: GetPolicy moves to the new revision while the old one
// stays readable and unchanged.
func TestPolicyStatements_ReviseAppendsRevision(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		entity := createPolicy(t, d.stmts, projectID, testPolicyOperation, `{"min_length":8}`)
		first := entity.RevisionID

		entity.Config = []byte(`{"min_length":15}`)
		require.NoError(t, d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			if err := tx.Statements().LockPolicy(ctx, projectID, entity.ID); err != nil {
				return err
			}
			return tx.Statements().RevisePolicy(ctx, entity)
		}))
		assert.NotEqual(t, first, entity.RevisionID)
		assert.True(t, domain.PrefixPolicyRevision.Matches(entity.RevisionID))
		assert.False(t, entity.UpdatedAt.Before(entity.CreatedAt))

		newest, err := d.stmts.GetPolicy(t.Context(), projectID, testPolicyOperation)
		require.NoError(t, err)
		assert.Equal(t, entity.RevisionID, newest.RevisionID)
		assert.JSONEq(t, `{"min_length":15}`, string(newest.Config))
		assert.True(t, newest.CreatedAt.Equal(entity.CreatedAt), "CreatedAt stays the first publish")

		pinned, err := d.stmts.GetPolicyRevision(t.Context(), projectID, first)
		require.NoError(t, err)
		assert.JSONEq(t, `{"min_length":8}`, string(pinned.Config), "an appended revision must not rewrite the one before it")
	})
}

func TestPolicyStatements_NotFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)

		_, err := d.stmts.GetPolicy(t.Context(), projectID, testPolicyOperation)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetPolicyRevision(t.Context(), projectID, "polrev_unknown")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		err = d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return tx.Statements().LockPolicy(ctx, projectID, "pol_unknown")
		})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		err = d.stmts.RevisePolicy(t.Context(), &domain.Policy{ProjectID: projectID, ID: "pol_unknown", Config: []byte(`{}`)})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		// A revision of another project's policy is not found from this one.
		foreign := createPolicy(t, d.stmts, ensureProject(t, d.stmts), testPolicyOperation, `{}`)
		_, err = d.stmts.GetPolicyRevision(t.Context(), projectID, foreign.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// Create writes three rows in one transaction, so a failure must leave nothing
// behind: a retry would otherwise hit the operation of a policy that was
// never created.
func TestPolicyStatements_FailedCreateLeavesNothing(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)

		// Valid JSON of the wrong shape: the policy insert succeeds and the
		// revision's config CHECK rejects the array, in every dialect.
		entity := &domain.Policy{ProjectID: projectID, Operation: testPolicyOperation, Config: []byte(`[]`)}
		require.Error(t, d.stmts.CreatePolicy(t.Context(), entity))
		require.NotEmpty(t, entity.ID)
		require.NotEmpty(t, entity.RevisionID)

		_, err := d.stmts.GetPolicy(t.Context(), projectID, testPolicyOperation)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetPolicyRevision(t.Context(), projectID, entity.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindPolicy, projectID, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		createPolicy(t, d.stmts, projectID, testPolicyOperation, `{}`) // the operation is free for the retry
	})
}

// A publish whose transaction began before a concurrent one but took the
// lock after it must still stamp its revision after the one it follows, or
// GetPolicy would serve the older write as newest. See the IDP connection
// test of the same name for why (postgres' now() is transaction start).
func TestPolicyStatements_LateReviseInEarlyTransactionStampsLast(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		if d.name == "sqlite" {
			t.Skip("sqlite serializes writers; interleaving not constructible")
		}
		projectID := ensureProject(t, d.stmts)
		entity := createPolicy(t, d.stmts, projectID, testPolicyOperation, `{"min_length":8}`)

		revise := func(ctx context.Context, tx service.Statementer[service.AllStatements], config string, out *domain.Policy) error {
			if err := tx.Statements().LockPolicy(ctx, projectID, entity.ID); err != nil {
				return err
			}
			next := *entity
			next.Config = []byte(config)
			if err := tx.Statements().RevisePolicy(ctx, &next); err != nil {
				return err
			}
			*out = next
			return nil
		}

		var begun sync.Once
		begunCh := make(chan struct{})
		proceedCh := make(chan struct{})
		var late domain.Policy
		lateErr := make(chan error, 1)
		go func() {
			lateErr <- d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				// A statement fixes the transaction's start before the early one
				// runs. It reads the project, which neither revision writes: a
				// read of the policy would hold a shared lock on Spanner that the
				// early transaction's LockPolicy waits on while this one waits
				// for it to finish.
				if _, err := tx.Statements().GetProjectByID(ctx, projectID); err != nil {
					return err
				}
				begun.Do(func() { close(begunCh) })
				<-proceedCh
				return revise(ctx, tx, `{"min_length":20}`, &late)
			})
		}()
		select {
		case <-begunCh:
		case err := <-lateErr:
			t.Fatalf("the late transaction ended before it began waiting: %v", err)
		}

		var early domain.Policy
		earlyErr := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return revise(ctx, tx, `{"min_length":15}`, &early)
		})
		close(proceedCh)
		require.NoError(t, earlyErr)
		require.NoError(t, <-lateErr)

		assert.True(t, late.UpdatedAt.After(early.UpdatedAt),
			"the late revise stamped %s, not after the revision it followed (%s)", late.UpdatedAt, early.UpdatedAt)
		newest, err := d.stmts.GetPolicy(t.Context(), projectID, testPolicyOperation)
		require.NoError(t, err)
		assert.Equal(t, late.RevisionID, newest.RevisionID, "the late revise must be the newest revision")
	})
}
