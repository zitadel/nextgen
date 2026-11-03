package userrecoverycodes_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/userrecoverycodes"
)

// The absent state must bind untyped nil: a typed nil slips past the compare
// compiler's nil checks and binds NULL into an ordered compare.
func TestSchemaNullableBindings(t *testing.T) {
	col := database.Col(domain.UserRecoveryCodesFieldLastSuccessfulCheck)
	cols := []database.Column[domain.UserRecoveryCodesField]{col}

	assert.True(t, userrecoverycodes.Schema.Nullable(col))
	v := userrecoverycodes.Schema.ValuesFrom(&domain.UserRecoveryCodes{}, cols)[0]
	assert.True(t, v == nil, "last_successful_check must bind untyped nil")

	checked := time.Unix(1700000000, 0).UTC()
	codes := &domain.UserRecoveryCodes{LastSuccessfulCheck: &checked}
	assert.Equal(t, []any{checked}, userrecoverycodes.Schema.ValuesFrom(codes, cols))
}
