package userpasskey_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/userpasskey"
)

// The absent state must bind untyped nil: a typed nil slips past the compare
// compiler's nil checks and binds NULL into an ordered compare.
func TestSchemaNullableBindings(t *testing.T) {
	cols := []database.Column[domain.UserPasskeyField]{
		database.Col(domain.UserPasskeyFieldName),
		database.Col(domain.UserPasskeyFieldVerifiedAt),
		database.Col(domain.UserPasskeyFieldLastUsedAt),
	}
	for _, col := range cols {
		assert.True(t, userpasskey.Schema.Nullable(col), userpasskey.Schema.SQLName(col))
	}

	// name is nullable in the DDL, but the domain has no absent name: "" binds
	// as "", so only the pointer fields carry an absent state.
	absent := []database.Column[domain.UserPasskeyField]{
		database.Col(domain.UserPasskeyFieldVerifiedAt),
		database.Col(domain.UserPasskeyFieldLastUsedAt),
	}
	for i, v := range userpasskey.Schema.ValuesFrom(&domain.UserPasskey{}, absent) {
		assert.True(t, v == nil, "%s must bind untyped nil", userpasskey.Schema.SQLName(absent[i]))
	}

	verified := time.Unix(1700000000, 0).UTC()
	used := verified.Add(time.Hour)
	passkey := &domain.UserPasskey{Name: "Laptop", VerifiedAt: &verified, LastUsedAt: &used}
	assert.Equal(t, []any{"Laptop", verified, used}, userpasskey.Schema.ValuesFrom(passkey, cols))
}
