//go:build postgres_integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func userPasskeyKeyFilter(projectID, userID, credentialID string) database.Filter[domain.UserPasskeyField] {
	return database.And(
		database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credentialID),
	)
}

func ensureUserPasskeyTestFixture(t *testing.T) (projectID, userID, credentialID string) {
	t.Helper()
	ctx := t.Context()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, testPool.CreateProject(ctx, project))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })

	schemaURL := "https://example.com/schemas/test-user-passkey"
	_, err := testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3)`,
		project.ID, schemaURL, []byte(`{"type":"object"}`),
	)
	require.NoError(t, err)

	userID = "user_passkey_1"
	emailAttr, err := domain.NewCreateAttribute("email", "passkey@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, testPool.CreateUser(ctx, &domain.CreateUser{
		ProjectID:  project.ID,
		SchemaURL:  schemaURL,
		ID:         userID,
		Attributes: []*domain.CreateAttribute{emailAttr},
	}))
	t.Cleanup(func() { _ = testPool.DeleteUserByID(context.Background(), project.ID, userID) })

	credentialID = "cred-passkey-1"
	attestation := "none"
	now := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, testPool.CreateUserPasskey(ctx, &domain.CreateUserPasskey{
		ProjectID:       project.ID,
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
		_ = testPool.DeleteUserPasskey(context.Background(), userPasskeyKeyFilter(project.ID, userID, credentialID))
	})

	return project.ID, userID, credentialID
}

func TestUserPasskeyStatements_Update(t *testing.T) {
	ctx := t.Context()
	projectID, userID, credentialID := ensureUserPasskeyTestFixture(t)
	byKey := userPasskeyKeyFilter(projectID, userID, credentialID)

	err := testPool.UpdateUserPasskey(ctx, byKey)
	assert.ErrorIs(t, err, database.ErrNoChanges)

	err = testPool.UpdateUserPasskey(ctx, userPasskeyKeyFilter(projectID, userID, "missing-cred"),
		&domain.UserPasskeySignCountUpdate{SignCount: 2},
	)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))

	now := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, testPool.UpdateUserPasskey(ctx, byKey,
		&domain.UserPasskeyAttestationTypeUpdate{AttestationType: "direct"},
		&domain.UserPasskeyTransportsUpdate{Transports: []string{"usb", "nfc"}},
		&domain.UserPasskeySignCountUpdate{SignCount: 5},
		&domain.UserPasskeyBackupEligibleUpdate{BackupEligible: false},
		&domain.UserPasskeyBackupStateUpdate{BackupState: true},
		&domain.UserPasskeyVerifiedAtUpdate{VerifiedAt: now},
		&domain.UserPasskeyLastUsedAtUpdate{LastUsedAt: now},
	))

	got, err := testPool.GetUserPasskey(ctx, byKey)
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

	require.NoError(t, testPool.UpdateUserPasskey(ctx, byKey,
		&domain.UserPasskeyTransportsUpdate{Transports: nil},
	))
	got, err = testPool.GetUserPasskey(ctx, byKey)
	require.NoError(t, err)
	assert.Equal(t, []string{}, got.Transports)
}
