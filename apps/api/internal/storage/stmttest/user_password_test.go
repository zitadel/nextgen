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

		// A rehash keeps the row, its created_at and the history.
		require.NoError(t, d.stmts.UpdateUserPasswordHash(t.Context(), got2, "rehash"))
		got3, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, got2.ID, got3.ID)
		assert.Equal(t, got2.CreatedAt, got3.CreatedAt)
		assert.Equal(t, "rehash", got3.EncodedHash)
		history, err = d.stmts.GetUserPasswordHistory(t.Context(), projectID, userID)
		require.NoError(t, err)
		require.Len(t, history, 1)
		assert.Equal(t, first.ID, history[0].ID)
		// got2 still carries the hash the rehash replaced.
		require.NoError(t, d.stmts.UpdateUserPasswordHash(t.Context(), got2, "rehash-b"))
		assert.Equal(t, "rehash", currentUserPasswordHash(t, d, projectID, userID), "a stale hash changes nothing")
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

		// Read inside the change's transaction, the history already starts
		// with the password the change replaced: the set-password action
		// reads it there to tell whether another change landed since its
		// policy check.
		var replaced []string
		require.NoError(t, d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			if err := set(ctx, tx, "hash-4"); err != nil {
				return err
			}
			history, err := tx.Statements().GetUserPasswordHistory(ctx, projectID, userID)
			replaced = replaced[:0]
			for _, pw := range history {
				replaced = append(replaced, pw.EncodedHash)
			}
			return err
		}))
		assert.Equal(t, []string{"hash-3", "hash-2", "hash-1"}, replaced)
	})
}

// Concurrent changes, including concurrent first-ever sets, must each succeed
// and keep the password they replaced: every hash ends up current or in the
// history, and the history runs strictly newest first. Each round releases its
// writers at once, so they meet as closely as the runner allows; two of them
// stamped in one microsecond used to fail on the unique index. A round has as
// many writers as the history is deep, so the current password and the
// history show all of them plus the password the round replaced.
func TestUserPasswordStatements_HistoryUnderConcurrentChanges(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_history_race"
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "PW History Race")))

		var replaced []string // the first round sets the first password
		for round := range 8 {
			want := replaced
			start := make(chan struct{})
			errs := make(chan error, domain.UserPasswordHistoryDepth)
			var wg sync.WaitGroup
			for writer := range domain.UserPasswordHistoryDepth {
				hash := fmt.Sprintf("hash-%d-%d", round, writer)
				want = append(want, hash)
				wg.Go(func() {
					<-start
					errs <- d.stmts.SetUserPassword(context.Background(), &domain.SetUserPassword{
						ProjectID:   projectID,
						UserID:      userID,
						EncodedHash: hash,
					})
				})
			}
			close(start)
			wg.Wait()
			close(errs)
			for err := range errs {
				require.NoError(t, err, "round %d", round)
			}

			current, err := d.stmts.GetUserPassword(t.Context(), userPasswordByUser(projectID, userID))
			require.NoError(t, err)
			history, err := d.stmts.GetUserPasswordHistory(t.Context(), projectID, userID)
			require.NoError(t, err)
			got, newer := []string{current.EncodedHash}, current.CreatedAt
			for _, pw := range history {
				assert.True(t, pw.CreatedAt.Before(newer), "round %d: %s is not older than the password after it", round, pw.EncodedHash)
				got, newer = append(got, pw.EncodedHash), pw.CreatedAt
			}
			assert.ElementsMatch(t, want, got, "round %d", round)
			replaced = []string{current.EncodedHash}
		}
	})
}

// A second change of one user waits until the first commits, then stamps after
// it. Postgres waits on the user row's lock and SQLite on the write lock the
// open transaction holds, so B cannot land while A is open. Spanner aborts one
// of the two and replays it; the emulator aborts the open one, so there A often
// lands after B. On every dialect both land and each keeps what it replaced.
func TestUserPasswordStatements_SetWaitsForConcurrentSet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_wait"
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-wait@example.com", "PW Wait")))
		setTestUserPassword(t, d, projectID, userID, "hash-0")

		set := func(ctx context.Context, stmts service.AllStatements, hash string) error {
			return stmts.SetUserPassword(ctx, &domain.SetUserPassword{
				ProjectID:   projectID,
				UserID:      userID,
				EncodedHash: hash,
			})
		}

		var setA sync.Once
		setACh := make(chan struct{})
		releaseCh := make(chan struct{})
		errA := make(chan error, 1)
		go func() {
			// No require in here: it would leave setACh open and hang the test.
			errA <- d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				if err := set(ctx, tx.Statements(), "hash-a"); err != nil {
					return err
				}
				// Once, though spanner replays aborted attempts.
				setA.Do(func() { close(setACh) })
				<-releaseCh
				return nil
			})
		}()
		select {
		case <-setACh:
		case err := <-errA:
			t.Fatalf("transaction A ended before it set its password: %v", err)
		}

		errB := make(chan error, 1)
		go func() { errB <- set(context.Background(), d.stmts, "hash-b") }()
		// The timer checks a lock property only: on Postgres and SQLite, B
		// cannot land while A is open. A slow runner can only make it miss.
		select {
		case err := <-errB:
			if d.name != "spanner" {
				t.Errorf("B's change landed while A's transaction was open: %v", err)
			}
			errB <- err
		case <-time.After(200 * time.Millisecond):
		}

		close(releaseCh)
		require.NoError(t, <-errA)
		require.NoError(t, <-errB)

		current := currentUserPasswordHash(t, d, projectID, userID)
		got := append(userPasswordHistoryHashes(t, d, projectID, userID), current)
		assert.ElementsMatch(t, []string{"hash-0", "hash-a", "hash-b"}, got)
		if d.name != "spanner" {
			assert.Equal(t, "hash-b", current, "B landed after A, so B is current")
		}
	})
}

// A new password must become current even when the clock reads earlier than
// the newest password, as after the clock steps back or a failover to a
// server whose clock lags: the newest row is the current password, so a set
// stamps its row after that one rather than at the clock.
func TestUserPasswordStatements_SetStampsAfterNewest(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_clock"
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-clock@example.com", "PW Clock")))
		ahead := time.Now().Add(time.Hour).UTC().Truncate(time.Microsecond)
		require.NoError(t, d.insertUserPasswordAt(t.Context(), projectID, string(domain.PrefixUserPassword)+"_ahead", userID, "hash-ahead", ahead))

		setTestUserPassword(t, d, projectID, userID, "hash-now")

		assert.Equal(t, "hash-now", currentUserPasswordHash(t, d, projectID, userID), "the password set last is current")
		assert.Equal(t, []string{"hash-ahead"}, userPasswordHistoryHashes(t, d, projectID, userID))
	})
}
