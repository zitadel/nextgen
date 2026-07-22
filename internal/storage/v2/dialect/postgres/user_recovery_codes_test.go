//go:build postgres_integration

package postgres

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func insertUserRecoveryCodesFixtures(t *testing.T, ctx context.Context, pid, tid, schemaURL, userID string) {
	t.Helper()
	require.NoError(t, testPool.CreateProject(ctx, newTestProject(pid)))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), pid) })

	err := testPool.Transaction(ctx, func(ctx context.Context, stx service.Statementer[service.AllStatements]) error {
		tx, ok := stx.(legacydb.QueryExecutor)
		if !ok {
			t.Fatal("expected v2 transaction to implement QueryExecutor")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1, $2)`, pid, tid); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3::jsonb)`,
			pid, schemaURL, []byte("{}"),
		); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, lifecycle_owner_team_id, status) VALUES ($1, $2, $3, $4, $5)`,
			pid, schemaURL, userID, tid, domain.UserStatusActive.String(),
		)
		return err
	})
	require.NoError(t, err)
}

func TestUserRecoveryCodesStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	pid := uniqueProjectID(t)
	const (
		tid       = "team-cred-rc"
		schemaURL = "https://schemas.test/cred-rc.json"
		userID    = "usr_rc"
	)
	insertUserRecoveryCodesFixtures(t, ctx, pid, tid, schemaURL, userID)

	codes := []string{"aaaa-bbbb-cccc", "dddd-eeee-ffff"}
	require.NoError(t, testPool.CreateUserRecoveryCodes(ctx, &domain.CreateRecoveryCodes{
		ProjectID:     pid,
		UserID:        userID,
		RecoveryCodes: codes,
	}))

	got, err := testPool.GetUserRecoveryCodesByUserID(ctx, pid, userID)
	require.NoError(t, err)
	require.Positive(t, got.ID)
	require.Equal(t, codes, got.RecoveryCodes)

	byID, err := testPool.GetUserRecoveryCodesByID(ctx, got.ID)
	require.NoError(t, err)
	require.Equal(t, got.ID, byID.ID)

	listed, err := testPool.ListUserRecoveryCodes(ctx, &v2database.ListOptions[domain.UserRecoveryCodesField]{
		Filter: v2database.Equal(v2database.Col(domain.UserRecoveryCodesFieldProjectID), pid),
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)

	require.NoError(t, testPool.DeleteUserRecoveryCodesByID(ctx, got.ID))
	_, err = testPool.GetUserRecoveryCodesByUserID(ctx, pid, userID)
	require.ErrorIs(t, err, new(legacydb.NoRowFoundError))

	require.NoError(t, testPool.CreateUserRecoveryCodes(ctx, &domain.CreateRecoveryCodes{
		ProjectID:     pid,
		UserID:        userID,
		RecoveryCodes: codes,
	}))
	got2, err := testPool.GetUserRecoveryCodesByUserID(ctx, pid, userID)
	require.NoError(t, err)
	require.Positive(t, got2.ID)
	require.NoError(t, testPool.DeleteUserRecoveryCodesByUserID(ctx, pid, userID))
	_, err = testPool.GetUserRecoveryCodesByUserID(ctx, pid, userID)
	require.ErrorIs(t, err, new(legacydb.NoRowFoundError))
}
