//go:build spanner_integration

package spanner

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"cloud.google.com/go/spanner"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func userPasskeyKeyFilter(projectID, userID, credentialID string) database.Filter[domain.UserPasskeyField] {
	return database.And(
		database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credentialID),
	)
}

func TestUserPasskeyStatements_Update(t *testing.T) {
	ctx := t.Context()

	connector, stop, err := dbtest.Spanner(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	cfg, ok := connector.(*spannerdialect.Config)
	require.True(t, ok)

	sqlDB, err := sql.Open("spanner", cfg.DSN)
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, migration.Migrate(ctx, sqlDB))

	dialect, err := DecodeConfig(cfg.DSN)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(ctx) })

	client := pool.(*Client)
	stmts := client.Statements()

	projectID := "proj_passkey_upd"
	userID := "user_passkey_upd"
	credentialID := "cred-passkey-upd"
	schemaURL := "https://example.com/schemas/test-user-passkey"
	byKey := userPasskeyKeyFilter(projectID, userID, credentialID)

	require.NoError(t, stmts.CreateProject(ctx, &domain.Project{ID: projectID, PreviewOrigins: []string{}}))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	_, err = client.client.Apply(ctx, []*spanner.Mutation{
		spanner.InsertMap("json_schemas", map[string]any{
			"project_id": projectID,
			"url":        schemaURL,
			"payload":    spanner.NullJSON{Value: map[string]any{"type": "object"}, Valid: true},
		}),
	})
	require.NoError(t, err)

	emailAttr, err := domain.NewCreateAttribute("email", "passkey-upd@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, stmts.CreateUser(ctx, &domain.CreateUser{
		ProjectID:  projectID,
		SchemaURL:  schemaURL,
		ID:         userID,
		Attributes: []*domain.CreateAttribute{emailAttr},
	}))
	t.Cleanup(func() { _ = stmts.DeleteUserByID(context.Background(), projectID, userID) })

	attestation := "none"
	now := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, stmts.CreateUserPasskey(ctx, &domain.CreateUserPasskey{
		ProjectID:       projectID,
		UserID:          userID,
		CredentialID:    credentialID,
		PublicKey:       []byte{0x01, 0x02, 0x03},
		AAGUID:          []byte{0x0a, 0x0b},
		AttestationType: &attestation,
		Transports:      []string{"internal"},
		SignCount:       1,
		BackupEligible:  true,
		BackupState:     false,
		VerifiedAt:      &now,
	}))
	t.Cleanup(func() {
		_ = stmts.DeleteUserPasskey(context.Background(), byKey)
	})

	err = stmts.UpdateUserPasskey(ctx, byKey)
	assert.ErrorIs(t, err, database.ErrNoChanges)

	err = stmts.UpdateUserPasskey(ctx, userPasskeyKeyFilter(projectID, userID, "missing-cred"),
		&domain.UserPasskeySignCountUpdate{SignCount: 2},
	)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))

	require.NoError(t, stmts.UpdateUserPasskey(ctx, byKey,
		&domain.UserPasskeyAttestationTypeUpdate{AttestationType: "direct"},
		domain.NewUserPasskeyTransportsUpdate([]string{"usb", "nfc"}),
		&domain.UserPasskeySignCountUpdate{SignCount: 5},
		&domain.UserPasskeyBackupEligibleUpdate{BackupEligible: false},
		&domain.UserPasskeyBackupStateUpdate{BackupState: true},
		&domain.UserPasskeyVerifiedAtUpdate{VerifiedAt: now},
		&domain.UserPasskeyLastUsedAtUpdate{LastUsedAt: now},
	))

	got, err := stmts.GetUserPasskey(ctx, byKey)
	require.NoError(t, err)
	require.NotNil(t, got.AttestationType)
	assert.Equal(t, "direct", *got.AttestationType)
	assert.Equal(t, []string{"usb", "nfc"}, got.Transports)
	assert.Equal(t, int64(5), got.SignCount)
	assert.False(t, got.BackupEligible)
	assert.True(t, got.BackupState)
	require.NotNil(t, got.VerifiedAt)
	assert.WithinDuration(t, now, *got.VerifiedAt, time.Second)
	require.NotNil(t, got.LastUsedAt)
	assert.WithinDuration(t, now, *got.LastUsedAt, time.Second)

	require.NoError(t, stmts.UpdateUserPasskey(ctx, byKey,
		&domain.UserPasskeyIncrementSignCountUpdate{Delta: 3},
	))
	got, err = stmts.GetUserPasskey(ctx, byKey)
	require.NoError(t, err)
	assert.Equal(t, int64(8), got.SignCount)

	require.NoError(t, stmts.UpdateUserPasskey(ctx, byKey,
		domain.NewUserPasskeyTransportsUpdate(nil),
	))
	got, err = stmts.GetUserPasskey(ctx, byKey)
	require.NoError(t, err)
	assert.Equal(t, []string{}, got.Transports)
}
