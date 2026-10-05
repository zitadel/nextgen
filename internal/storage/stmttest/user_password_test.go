//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func userPasswordByUser(projectID, userID string) database.Filter[domain.UserPasswordField] {
	return database.And(
		database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
	)
}

func userPasswordByID(id string) database.Filter[domain.UserPasswordField] {
	return database.Equal(database.Col(domain.UserPasswordFieldID), id)
}

func TestUserPasswordStatements_SetGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw@example.com", "PW User")))

		require.NoError(t, d.stmts.SetUserPassword(t.Context(), &domain.SetUserPassword{
			ProjectID:   projectID,
			UserID:      userID,
			EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$fake",
		}))

		byUser := userPasswordByUser(projectID, userID)
		got, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err)
		require.NotEmpty(t, got.ID)
		assert.True(t, strings.HasPrefix(got.ID, string(domain.PrefixUserPassword)+"_"))
		assert.Equal(t, projectID, got.ProjectID)
		assert.Equal(t, userID, got.UserID)
		assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$fake", got.EncodedHash)
		assert.WithinDuration(t, time.Now(), got.CreatedAt, 5*time.Second)

		gotByID, err := d.stmts.GetUserPassword(t.Context(), userPasswordByID(got.ID))
		require.NoError(t, err)
		assert.Equal(t, got.ID, gotByID.ID)

		list, err := d.stmts.ListUserPasswords(t.Context(), &database.ListOptions[domain.UserPasswordField]{
			Filter: database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
		})
		require.NoError(t, err)
		require.Len(t, list.Items, 1)
	})
}

func TestUserPasswordStatements_SetAddsCurrentPassword(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_replace"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-replace@example.com", "PW Replace")))

		byUser := userPasswordByUser(projectID, userID)
		first := &domain.SetUserPassword{
			ProjectID:   projectID,
			UserID:      userID,
			EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$initial",
		}
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), first))
		require.True(t, domain.PrefixUserPassword.Matches(first.ID))
		got, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, first.ID, got.ID)

		replacement := &domain.SetUserPassword{
			ProjectID:   projectID,
			UserID:      userID,
			EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$updated",
		}
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), replacement))
		require.True(t, domain.PrefixUserPassword.Matches(replacement.ID))
		assert.NotEqual(t, first.ID, replacement.ID, "each password is its own row")

		got2, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err, "a user filter still matches only the current password")
		assert.Equal(t, replacement.ID, got2.ID)
		assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$updated", got2.EncodedHash)
		assert.True(t, got2.CreatedAt.After(got.CreatedAt))

		history, err := d.stmts.GetUserPasswordHistory(t.Context(), projectID, userID)
		require.NoError(t, err)
		require.Len(t, history, 1)
		assert.Equal(t, first.ID, history[0].ID)
		_, err = d.stmts.GetUserPassword(t.Context(), userPasswordByID(first.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a previous password is not readable as current")
	})
}

func TestUserPasswordStatements_SetMissingUser(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := ensureUserTestProject(t, d.stmts)

		err := d.stmts.SetUserPassword(t.Context(), &domain.SetUserPassword{
			ProjectID:   projectID,
			UserID:      "missing-user",
			EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$fake",
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
	})
}

func userPasswordHistoryHashes(t *testing.T, d dialect, projectID, userID string) []string {
	t.Helper()
	history, err := d.stmts.GetUserPasswordHistory(t.Context(), projectID, userID)
	require.NoError(t, err)
	hashes := make([]string, 0, len(history))
	for _, pw := range history {
		hashes = append(hashes, pw.EncodedHash)
	}
	return hashes
}

func currentUserPasswordHash(t *testing.T, d dialect, projectID, userID string) string {
	t.Helper()
	pw, err := d.stmts.GetUserPassword(t.Context(), userPasswordByUser(projectID, userID))
	require.NoError(t, err)
	return pw.EncodedHash
}

func setTestUserPassword(t *testing.T, d dialect, projectID, userID, hash string) {
	t.Helper()
	require.NoError(t, d.stmts.SetUserPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   projectID,
		UserID:      userID,
		EncodedHash: hash,
	}))
}

func TestUserPasswordStatements_HistoryKeepsPreviousPasswords(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_history"
		otherID := "user_pw_history_other"
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-history@example.com", "PW History")))
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, otherID, "pw-history-other@example.com", "PW History Other")))

		assert.Empty(t, userPasswordHistoryHashes(t, d, projectID, userID), "a user without a password has no history")

		setTestUserPassword(t, d, projectID, userID, "hash-1")
		assert.Empty(t, userPasswordHistoryHashes(t, d, projectID, userID), "the current password is not history")

		setTestUserPassword(t, d, projectID, userID, "hash-2")
		assert.Equal(t, []string{"hash-1"}, userPasswordHistoryHashes(t, d, projectID, userID))

		for i := 3; i <= 7; i++ {
			setTestUserPassword(t, d, projectID, userID, fmt.Sprintf("hash-%d", i))
		}
		assert.Equal(t, "hash-7", currentUserPasswordHash(t, d, projectID, userID))
		assert.Equal(t, []string{"hash-6", "hash-5", "hash-4", "hash-3"}, userPasswordHistoryHashes(t, d, projectID, userID),
			"newest first, at most the depth")
		list, err := d.stmts.ListUserPasswords(t.Context(), &database.ListOptions[domain.UserPasswordField]{
			Filter: userPasswordByUser(projectID, userID),
		})
		require.NoError(t, err)
		require.Len(t, list.Items, 1, "lists see current passwords only")

		setTestUserPassword(t, d, projectID, otherID, "other-1")
		setTestUserPassword(t, d, projectID, otherID, "other-2")
		assert.Equal(t, []string{"other-1"}, userPasswordHistoryHashes(t, d, projectID, otherID), "history is per user")
		assert.Len(t, userPasswordHistoryHashes(t, d, projectID, userID), domain.UserPasswordHistoryDepth,
			"another user's changes leave this history alone")

		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), projectID, userID))
		assert.Empty(t, userPasswordHistoryHashes(t, d, projectID, userID), "history goes with the user")
		assert.Equal(t, []string{"other-1"}, userPasswordHistoryHashes(t, d, projectID, otherID))
	})
}

func TestUserPasswordStatements_HistoryFollowsTheChangeTransaction(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_history_tx"
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-history-tx@example.com", "PW History Tx")))
		setTestUserPassword(t, d, projectID, userID, "hash-1")

		set := func(ctx context.Context, tx service.Statementer[service.AllStatements], hash string) error {
			return tx.Statements().SetUserPassword(ctx, &domain.SetUserPassword{
				ProjectID:   projectID,
				UserID:      userID,
				EncodedHash: hash,
			})
		}

		errRollback := errors.New("rollback")
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			if err := set(ctx, tx, "hash-2"); err != nil {
				return err
			}
			return errRollback
		})
		require.ErrorIs(t, err, errRollback)
		assert.Equal(t, "hash-1", currentUserPasswordHash(t, d, projectID, userID), "a change that fails changes nothing")
		assert.Empty(t, userPasswordHistoryHashes(t, d, projectID, userID))

		// Two changes in one transaction still order.
		require.NoError(t, d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			if err := set(ctx, tx, "hash-2"); err != nil {
				return err
			}
			return set(ctx, tx, "hash-3")
		}))
		assert.Equal(t, "hash-3", currentUserPasswordHash(t, d, projectID, userID))
		assert.Equal(t, []string{"hash-2", "hash-1"}, userPasswordHistoryHashes(t, d, projectID, userID))
	})
}

// Concurrent changes, including concurrent first-ever sets, must each keep the
// password they replaced: every hash ends up current or in the history.
func TestUserPasswordStatements_HistoryUnderConcurrentChanges(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		for _, start := range []string{"", "hash-0"} {
			userID := "user_pw_history_race" + start
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "PW History Race")))
			want := []string{"hash-a", "hash-b", "hash-c"}
			if start != "" {
				setTestUserPassword(t, d, projectID, userID, start)
				want = append(want, start)
			}

			var wg sync.WaitGroup
			errs := make(chan error, 3)
			for _, hash := range []string{"hash-a", "hash-b", "hash-c"} {
				wg.Go(func() {
					errs <- d.stmts.SetUserPassword(context.Background(), &domain.SetUserPassword{
						ProjectID:   projectID,
						UserID:      userID,
						EncodedHash: hash,
					})
				})
			}
			wg.Wait()
			close(errs)
			for err := range errs {
				require.NoError(t, err)
			}

			got := append(userPasswordHistoryHashes(t, d, projectID, userID), currentUserPasswordHash(t, d, projectID, userID))
			assert.ElementsMatch(t, want, got, "start %q", start)
		}
	})
}

func TestUserPasswordStatements_Failures(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_failures"
		otherID := "user_pw_failures_other"
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-failures@example.com", "PW Failures")))
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, otherID, "pw-failures-other@example.com", "PW Failures Other")))
		setTestUserPassword(t, d, projectID, userID, "hash-1")

		start := time.Now().UTC().Truncate(time.Microsecond)
		failures := func(since time.Time) domain.UserPasswordFailures {
			t.Helper()
			got, err := d.stmts.GetUserPasswordFailures(t.Context(), projectID, userID, since)
			require.NoError(t, err)
			return got
		}
		add := func(userID string, at, forgetBefore time.Time) {
			t.Helper()
			require.NoError(t, d.stmts.AddUserPasswordFailure(t.Context(), projectID, userID, at, forgetBefore))
		}
		longAgo := start.Add(-365 * 24 * time.Hour)

		got := failures(longAgo)
		assert.Zero(t, got.Count, "no failures yet")
		assert.True(t, got.LastFailedAt.IsZero())

		for i := range 3 {
			add(userID, start.Add(time.Duration(i)*time.Minute), longAgo)
		}
		add(otherID, start.Add(time.Hour), longAgo)
		got = failures(longAgo)
		assert.Equal(t, 3, got.Count, "another user's failures do not count")
		assert.True(t, start.Add(2*time.Minute).Equal(got.LastFailedAt), "got %v", got.LastFailedAt)
		assert.Equal(t, 2, failures(start).Count, "only failures after since count")

		setTestUserPassword(t, d, projectID, userID, "hash-2")
		assert.Equal(t, 3, failures(longAgo).Count, "failures belong to the user, not the password")

		add(userID, start.Add(3*time.Minute), start.Add(time.Minute))
		assert.Equal(t, 2, failures(longAgo).Count, "adding drops failures at or before forgetBefore")

		require.NoError(t, d.stmts.ClearUserPasswordFailures(t.Context(), projectID, userID, start.Add(2*time.Minute)))
		got = failures(longAgo)
		assert.Equal(t, 1, got.Count, "a clear keeps failures recorded after until")
		assert.True(t, start.Add(3*time.Minute).Equal(got.LastFailedAt))

		require.NoError(t, d.stmts.ClearUserPasswordFailures(t.Context(), projectID, userID, start.Add(time.Hour)))
		assert.Zero(t, failures(longAgo).Count)

		add(userID, start, longAgo)
		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), projectID, userID))
		assert.Zero(t, failures(longAgo).Count, "failures go with the user")
		other, err := d.stmts.GetUserPasswordFailures(t.Context(), projectID, otherID, longAgo)
		require.NoError(t, err)
		assert.Equal(t, 1, other.Count)

		err = d.stmts.AddUserPasswordFailure(t.Context(), projectID, "missing-user", start, longAgo)
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
	})
}

// Concurrent wrong passwords each add their own row, so all of them count.
func TestUserPasswordStatements_FailuresUnderConcurrency(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_failures_race"
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-failures-race@example.com", "PW Failures Race")))

		const guesses = 10
		now := time.Now().UTC().Truncate(time.Microsecond)
		forgetBefore := now.Add(-time.Hour)
		var wg sync.WaitGroup
		errs := make(chan error, guesses)
		for range guesses {
			wg.Go(func() {
				// The same instant on purpose: rows never collide on time.
				errs <- d.stmts.AddUserPasswordFailure(context.Background(), projectID, userID, now, forgetBefore)
			})
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			require.NoError(t, err)
		}

		got, err := d.stmts.GetUserPasswordFailures(t.Context(), projectID, userID, forgetBefore)
		require.NoError(t, err)
		assert.Equal(t, guesses, got.Count)
		assert.True(t, now.Equal(got.LastFailedAt))
	})
}
