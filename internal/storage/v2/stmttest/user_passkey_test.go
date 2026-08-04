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
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func userPasskeyKeyFilter(projectID, userID, credentialID string) database.Filter[domain.UserPasskeyField] {
	return database.And(
		database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credentialID),
	)
}

func ensureUserPasskeyTestUser(t *testing.T, stmts service.AllStatements, userID, email string) (projectID string) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, stmts)
	require.NoError(t, stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, email, "Passkey User")))
	return projectID
}

func TestUserPasskeyStatements_CreateGetListDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		userID := "user_passkey_crud"
		credentialID := "cred-passkey-crud"
		projectID := ensureUserPasskeyTestUser(t, d.stmts, userID, "passkey-crud@example.com")
		byKey := userPasskeyKeyFilter(projectID, userID, credentialID)

		attestation := "none"
		now := time.Now().UTC().Truncate(time.Millisecond)
		require.NoError(t, d.stmts.CreateUserPasskey(t.Context(), &domain.CreateUserPasskey{
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
			Name:            "Laptop",
			VerifiedAt:      &now,
		}))
		t.Cleanup(func() {
			_ = d.stmts.DeleteUserPasskey(context.Background(), byKey)
		})

		got, err := d.stmts.GetUserPasskey(t.Context(), byKey)
		require.NoError(t, err)
		require.NotEmpty(t, got.ID)
		assert.True(t, strings.HasPrefix(got.ID, string(domain.PrefixUserPasskey)+"_"))
		assert.Equal(t, projectID, got.ProjectID)
		assert.Equal(t, userID, got.UserID)
		assert.Equal(t, credentialID, got.CredentialID)
		assert.Equal(t, []byte{0x01, 0x02, 0x03}, got.PublicKey)
		assert.Equal(t, []byte{0x0a, 0x0b}, got.AAGUID)
		require.NotNil(t, got.AttestationType)
		assert.Equal(t, "none", *got.AttestationType)
		assert.Equal(t, []string{"internal"}, got.Transports)
		assert.Equal(t, int64(1), got.SignCount)
		assert.True(t, got.BackupEligible)
		assert.False(t, got.BackupState)
		assert.Equal(t, "Laptop", got.Name)
		require.NotNil(t, got.VerifiedAt)
		assert.WithinDuration(t, now, *got.VerifiedAt, time.Second)
		assert.False(t, got.CreatedAt.IsZero())
		assert.False(t, got.UpdatedAt.IsZero())

		listed, err := d.stmts.ListUserPasskeys(t.Context(), &database.ListOptions[domain.UserPasskeyField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		assert.Equal(t, got.ID, listed.Items[0].ID)

		require.NoError(t, d.stmts.DeleteUserPasskey(t.Context(), byKey))
		_, err = d.stmts.GetUserPasskey(t.Context(), byKey)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestUserPasskeyStatements_Update(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		userID := "user_passkey_1"
		credentialID := "cred-passkey-1"
		projectID := ensureUserPasskeyTestUser(t, d.stmts, userID, "passkey@example.com")
		byKey := userPasskeyKeyFilter(projectID, userID, credentialID)

		attestation := "none"
		now := time.Now().UTC().Truncate(time.Millisecond)
		require.NoError(t, d.stmts.CreateUserPasskey(t.Context(), &domain.CreateUserPasskey{
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
			_ = d.stmts.DeleteUserPasskey(context.Background(), byKey)
		})

		err := d.stmts.UpdateUserPasskey(t.Context(), byKey)
		assert.ErrorIs(t, err, database.ErrNoChanges)

		err = d.stmts.UpdateUserPasskey(t.Context(), userPasskeyKeyFilter(projectID, userID, "missing-cred"),
			&domain.UserPasskeySignCountUpdate{SignCount: 2},
		)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		require.NoError(t, d.stmts.UpdateUserPasskey(t.Context(), byKey,
			&domain.UserPasskeyAttestationTypeUpdate{AttestationType: "direct"},
			&domain.UserPasskeyTransportsUpdate{Transports: []string{"usb", "nfc"}},
			&domain.UserPasskeySignCountUpdate{SignCount: 5},
			&domain.UserPasskeyBackupEligibleUpdate{BackupEligible: false},
			&domain.UserPasskeyBackupStateUpdate{BackupState: true},
			&domain.UserPasskeyVerifiedAtUpdate{VerifiedAt: now},
			&domain.UserPasskeyLastUsedAtUpdate{LastUsedAt: now},
		))

		got, err := d.stmts.GetUserPasskey(t.Context(), byKey)
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

		require.NoError(t, d.stmts.UpdateUserPasskey(t.Context(), byKey,
			&domain.UserPasskeyTransportsUpdate{Transports: nil},
		))
		got, err = d.stmts.GetUserPasskey(t.Context(), byKey)
		require.NoError(t, err)
		assert.Equal(t, []string{}, got.Transports)
	})
}
