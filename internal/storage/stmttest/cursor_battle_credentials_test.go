//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func battleUserPasswords(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		userID := "usr-pw-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "PW")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), &domain.SetUserPassword{
			ProjectID:   projectID,
			UserID:      userID,
			EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$fixture",
		}))
		listed, err := d.stmts.ListUserPasswords(t.Context(), &database.ListOptions[domain.UserPasswordField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.UserPasswordField]{
		Columns:   []database.Column[domain.UserPasswordField]{database.Col(domain.UserPasswordFieldID)},
		Direction: database.OrderAsc,
	}
	drainIncarnation(t, want, filter, orderAsc, func(page database.Page[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error) {
		return d.stmts.ListUserPasswords(t.Context(), &database.ListOptions[domain.UserPasswordField]{
			Filter: filter, Pagination: page,
		})
	}, func(p *domain.UserPassword) string { return p.ID }, 2)
}

func battleUserTOTPs(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		userID := "usr-totp-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "TOTP")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		require.NoError(t, d.stmts.CreateUserTOTP(t.Context(), &domain.CreateUserTOTP{
			ProjectID: projectID,
			UserID:    userID,
			Secret:    []byte("secret-" + userID),
		}))
		listed, err := d.stmts.ListUserTOTPs(t.Context(), &database.ListOptions[domain.UserTOTPField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserTOTPFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserTOTPFieldUserID), userID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.Equal(database.Col(domain.UserTOTPFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.UserTOTPField]{
		Columns:   []database.Column[domain.UserTOTPField]{database.Col(domain.UserTOTPFieldID)},
		Direction: database.OrderAsc,
	}
	drainIncarnation(t, want, filter, orderAsc, func(page database.Page[domain.UserTOTPField]) (*database.ListResult[*domain.UserTOTP], error) {
		return d.stmts.ListUserTOTPs(t.Context(), &database.ListOptions[domain.UserTOTPField]{
			Filter: filter, Pagination: page,
		})
	}, func(item *domain.UserTOTP) string { return item.ID }, 2)
}

func battleUserPasskeys(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	userID := "usr-pk-" + uniqueSuffix(t)
	require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "PK")))
	t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

	want := make([]string, 0, 3)
	for i := range 3 {
		credID := "cred-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUserPasskey(t.Context(), &domain.CreateUserPasskey{
			ProjectID:    projectID,
			UserID:       userID,
			CredentialID: credID,
			PublicKey:    []byte{1, 2, 3, byte(i)},
			AAGUID:       []byte{0x0a, 0x0b},
			Name:         "key-" + string(rune('a'+i)),
		}))
		listed, err := d.stmts.ListUserPasskeys(t.Context(), &database.ListOptions[domain.UserPasskeyField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.And(
		database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
	)
	orderAsc := database.OrderBy[domain.UserPasskeyField]{
		Columns:   []database.Column[domain.UserPasskeyField]{database.Col(domain.UserPasskeyFieldID)},
		Direction: database.OrderAsc,
	}
	drainIncarnation(t, want, filter, orderAsc, func(page database.Page[domain.UserPasskeyField]) (*database.ListResult[*domain.UserPasskey], error) {
		return d.stmts.ListUserPasskeys(t.Context(), &database.ListOptions[domain.UserPasskeyField]{
			Filter: filter, Pagination: page,
		})
	}, func(item *domain.UserPasskey) string { return item.ID }, 2)
}

func battleUserRecoveryCodes(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		userID := "usr-rc-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "RC")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		require.NoError(t, d.stmts.CreateUserRecoveryCodes(t.Context(), &domain.CreateRecoveryCodes{
			ProjectID:     projectID,
			UserID:        userID,
			RecoveryCodes: []string{"aaaa-bbbb-cccc-" + string(rune('a'+i))},
		}))
		listed, err := d.stmts.ListUserRecoveryCodes(t.Context(), &database.ListOptions[domain.UserRecoveryCodesField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserRecoveryCodesFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserRecoveryCodesFieldUserID), userID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.Equal(database.Col(domain.UserRecoveryCodesFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.UserRecoveryCodesField]{
		Columns:   []database.Column[domain.UserRecoveryCodesField]{database.Col(domain.UserRecoveryCodesFieldID)},
		Direction: database.OrderAsc,
	}
	drainIncarnation(t, want, filter, orderAsc, func(page database.Page[domain.UserRecoveryCodesField]) (*database.ListResult[*domain.UserRecoveryCodes], error) {
		return d.stmts.ListUserRecoveryCodes(t.Context(), &database.ListOptions[domain.UserRecoveryCodesField]{
			Filter: filter, Pagination: page,
		})
	}, func(item *domain.UserRecoveryCodes) string { return item.ID }, 2)
}
