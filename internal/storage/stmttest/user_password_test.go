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

		vid := "verif-1"
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), &domain.SetUserPassword{
			ProjectID:      projectID,
			UserID:         userID,
			EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$fake",
			ChangeRequired: true,
			VerificationID: &vid,
		}))

		byUser := userPasswordByUser(projectID, userID)
		got, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err)
		require.NotEmpty(t, got.ID)
		assert.True(t, strings.HasPrefix(got.ID, string(domain.PrefixUserPassword)+"_"))
		assert.Equal(t, projectID, got.ProjectID)
		assert.Equal(t, userID, got.UserID)
		assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$fake", got.EncodedHash)
		assert.True(t, got.ChangeRequired)
		require.NotNil(t, got.VerificationID)
		assert.Equal(t, vid, *got.VerificationID)

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
			ProjectID:      projectID,
			UserID:         userID,
			EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$initial",
			ChangeRequired: true,
		}
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), first))
		require.True(t, domain.PrefixUserPassword.Matches(first.ID))
		got, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, first.ID, got.ID)

		now := time.Now().UTC().Truncate(time.Millisecond)
		require.NoError(t, d.stmts.UpdateUserPassword(t.Context(), byUser,
			&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 3},
			&domain.UserPasswordLastSuccessfulCheckUpdate{LastSuccessfulCheck: now},
		))

		replacement := &domain.SetUserPassword{
			ProjectID:      projectID,
			UserID:         userID,
			EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$updated",
			ChangeRequired: false,
		}
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), replacement))
		require.True(t, domain.PrefixUserPassword.Matches(replacement.ID))
		assert.NotEqual(t, first.ID, replacement.ID, "each password is its own row")

		got2, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err, "a user filter still matches only the current password")
		assert.Equal(t, replacement.ID, got2.ID)
		assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$updated", got2.EncodedHash)
		assert.False(t, got2.ChangeRequired)
		assert.Zero(t, got2.FailedAttempts)
		assert.Nil(t, got2.LastSuccessfulCheck)
		assert.WithinDuration(t, time.Now(), got2.CreatedAt, 5*time.Second)
		assert.True(t, got2.CreatedAt.After(got.CreatedAt))

		// Updates reach the current password only.
		require.NoError(t, d.stmts.UpdateUserPassword(t.Context(), byUser,
			&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1},
		))
		history, err := d.stmts.GetUserPasswordHistory(t.Context(), projectID, userID)
		require.NoError(t, err)
		require.Len(t, history, 1)
		assert.Equal(t, first.ID, history[0].ID)
		assert.Equal(t, int16(3), history[0].FailedAttempts)
		err = d.stmts.UpdateUserPassword(t.Context(), userPasswordByID(first.ID),
			&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1},
		)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a previous password is not updatable")
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

func TestUserPasswordStatements_Update(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "user_pw_upd"

		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, "pw-upd@example.com", "PW Update")))
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), &domain.SetUserPassword{
			ProjectID:   projectID,
			UserID:      userID,
			EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$initial",
		}))

		byUser := userPasswordByUser(projectID, userID)

		err := d.stmts.UpdateUserPassword(t.Context(), byUser)
		assert.ErrorIs(t, err, database.ErrNoChanges)

		err = d.stmts.UpdateUserPassword(t.Context(), userPasswordByUser(projectID, "missing-user"),
			&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1},
		)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		now := time.Now().UTC().Truncate(time.Millisecond)
		require.NoError(t, d.stmts.UpdateUserPassword(t.Context(), byUser,
			&domain.UserPasswordEncodedHashUpdate{EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$rotated"},
			&domain.UserPasswordChangeRequiredUpdate{ChangeRequired: true},
			&domain.UserPasswordVerificationIDUpdate{VerificationID: "verif-upd"},
			&domain.UserPasswordLastSuccessfulCheckUpdate{LastSuccessfulCheck: now},
			&domain.UserPasswordResetFailedAttemptsUpdate{},
		))

		got, err := d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, "argon2id$v=19$m=65536,t=3,p=4$rotated", got.EncodedHash)
		assert.True(t, got.ChangeRequired)
		require.NotNil(t, got.VerificationID)
		assert.Equal(t, "verif-upd", *got.VerificationID)
		require.NotNil(t, got.LastSuccessfulCheck)
		assert.WithinDuration(t, now, *got.LastSuccessfulCheck, time.Second)
		assert.Zero(t, got.FailedAttempts)

		require.NoError(t, d.stmts.UpdateUserPassword(t.Context(), byUser,
			&domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 2},
		))
		got, err = d.stmts.GetUserPassword(t.Context(), byUser)
		require.NoError(t, err)
		assert.Equal(t, int16(2), got.FailedAttempts)
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
