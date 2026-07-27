package userpasskey_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/userpasskey"
)

func TestAssignments(t *testing.T) {
	t.Parallel()

	_, err := userpasskey.Assignments(nil)
	assert.ErrorIs(t, err, database.ErrNoChanges)

	now := time.Now().UTC()
	got, err := userpasskey.Assignments([]domain.UserPasskeyChange{
		domain.UserPasskeySetAttestationType("direct"),
		domain.UserPasskeySetTransports(nil),
		domain.UserPasskeySetSignCount(9),
		domain.UserPasskeyIncrementSignCount(2),
		domain.UserPasskeySetBackupEligible(true),
		domain.UserPasskeySetBackupState(false),
		domain.UserPasskeySetVerifiedAt(now),
		domain.UserPasskeySetLastUsedAt(now),
	})
	require.NoError(t, err)
	require.Len(t, got, 8)

	assert.Equal(t, database.Assignment{Column: "attestation_type", Value: "direct"}, got[0])
	assert.Equal(t, database.Assignment{Column: "transports", Value: []string{}}, got[1])
	assert.Equal(t, database.Assignment{Column: "sign_count", Value: int64(9)}, got[2])
	assert.Equal(t, database.Assignment{Column: "sign_count", Expr: "sign_count + ?", ExprArgs: []any{int64(2)}}, got[3])
	assert.Equal(t, database.Assignment{Column: "backup_eligible", Value: true}, got[4])
	assert.Equal(t, database.Assignment{Column: "backup_state", Value: false}, got[5])
	assert.Equal(t, database.Assignment{Column: "verified_at", Value: now}, got[6])
	assert.Equal(t, database.Assignment{Column: "last_used_at", Value: now}, got[7])
}
