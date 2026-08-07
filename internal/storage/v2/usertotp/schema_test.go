package usertotp_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/usertotp"
)

// The absent state must bind untyped nil: a typed nil slips past the compare
// compiler's nil checks and binds NULL into an ordered compare.
func TestSchemaNullableBindings(t *testing.T) {
	cols := []database.Column[domain.UserTOTPField]{
		database.Col(domain.UserTOTPFieldVerifiedAt),
		database.Col(domain.UserTOTPFieldLastSuccessfulCheck),
	}
	for _, col := range cols {
		assert.True(t, usertotp.Schema.Nullable(col), usertotp.Schema.SQLName(col))
	}
	for i, v := range usertotp.Schema.ValuesFrom(&domain.UserTOTP{}, cols) {
		assert.True(t, v == nil, "%s must bind untyped nil", usertotp.Schema.SQLName(cols[i]))
	}

	verified := time.Unix(1700000000, 0).UTC()
	checked := verified.Add(time.Hour)
	totp := &domain.UserTOTP{VerifiedAt: verified, LastSuccessfulCheck: &checked}
	assert.Equal(t, []any{verified, checked}, usertotp.Schema.ValuesFrom(totp, cols))
}
