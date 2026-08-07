package userpassword_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/userpassword"
)

// The absent state must bind untyped nil: a typed nil slips past the compare
// compiler's nil checks and binds NULL into an ordered compare.
func TestSchemaNullableBindings(t *testing.T) {
	cols := []database.Column[domain.UserPasswordField]{
		database.Col(domain.UserPasswordFieldVerificationID),
		database.Col(domain.UserPasswordFieldLastSuccessfulCheck),
	}
	for _, col := range cols {
		assert.True(t, userpassword.Schema.Nullable(col), userpassword.Schema.SQLName(col))
	}
	for i, v := range userpassword.Schema.ValuesFrom(&domain.UserPassword{}, cols) {
		assert.True(t, v == nil, "%s must bind untyped nil", userpassword.Schema.SQLName(cols[i]))
	}

	checked := time.Unix(1700000000, 0).UTC()
	pw := &domain.UserPassword{VerificationID: new("ver_1"), LastSuccessfulCheck: &checked}
	assert.Equal(t, []any{"ver_1", checked}, userpassword.Schema.ValuesFrom(pw, cols))
}
