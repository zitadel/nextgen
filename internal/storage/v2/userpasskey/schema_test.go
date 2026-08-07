package userpasskey_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/userpasskey"
)

// The absent state must bind untyped nil: a typed nil slips past the compare
// compiler's nil checks and binds NULL into an ordered compare.
func TestSchemaNullableBindings(t *testing.T) {
	cols := []database.Column[domain.UserPasskeyField]{
		database.Col(domain.UserPasskeyFieldVerifiedAt),
		database.Col(domain.UserPasskeyFieldLastUsedAt),
	}
	for _, col := range cols {
		assert.True(t, userpasskey.Schema.Nullable(col), userpasskey.Schema.SQLName(col))
	}
	for i, v := range userpasskey.Schema.ValuesFrom(&domain.UserPasskey{}, cols) {
		assert.True(t, v == nil, "%s must bind untyped nil", userpasskey.Schema.SQLName(cols[i]))
	}

	verified := time.Unix(1700000000, 0).UTC()
	used := verified.Add(time.Hour)
	passkey := &domain.UserPasskey{VerifiedAt: &verified, LastUsedAt: &used}
	assert.Equal(t, []any{verified, used}, userpasskey.Schema.ValuesFrom(passkey, cols))
}
