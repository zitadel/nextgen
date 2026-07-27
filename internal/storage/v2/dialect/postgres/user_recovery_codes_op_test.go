package postgres

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestWriteUserRecoveryCodesOp(t *testing.T) {
	t.Run("set codes", func(t *testing.T) {
		var c statementCompiler
		err := writeUserRecoveryCodesOp(&c, domain.UserRecoveryCodesOp{
			Kind:  domain.UserRecoveryCodesOpSetCodes,
			Codes: []string{"a", "b"},
		})
		require.NoError(t, err)
		assert.Equal(t, "recovery_codes = $1", c.String())
		assert.Equal(t, []any{[]string{"a", "b"}}, c.args)
	})

	t.Run("empty codes rejected", func(t *testing.T) {
		var c statementCompiler
		err := writeUserRecoveryCodesOp(&c, domain.UserRecoveryCodesOp{
			Kind:  domain.UserRecoveryCodesOpSetCodes,
			Codes: nil,
		})
		assert.ErrorIs(t, err, domain.ErrEmptyRecoveryCodes)
		assert.Empty(t, c.String())
	})

	t.Run("last successful check null", func(t *testing.T) {
		var c statementCompiler
		err := writeUserRecoveryCodesOp(&c, domain.UserRecoveryCodesOp{
			Kind: domain.UserRecoveryCodesOpSetLastSuccessfulCheck,
			Time: nil,
		})
		require.NoError(t, err)
		assert.Equal(t, "last_successful_check = NULL", c.String())
		assert.Empty(t, c.args)
	})

	t.Run("last successful check set", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
		var c statementCompiler
		err := writeUserRecoveryCodesOp(&c, domain.UserRecoveryCodesOp{
			Kind: domain.UserRecoveryCodesOpSetLastSuccessfulCheck,
			Time: &now,
		})
		require.NoError(t, err)
		assert.Equal(t, "last_successful_check = $1", c.String())
		assert.Equal(t, []any{now}, c.args)
	})

	t.Run("increment and reset", func(t *testing.T) {
		var c statementCompiler
		require.NoError(t, writeUserRecoveryCodesOp(&c, domain.UserRecoveryCodesOp{
			Kind: domain.UserRecoveryCodesOpIncrementFailedAttempts,
		}))
		assert.Equal(t, "failed_attempts = failed_attempts + 1", c.String())

		c.Reset()
		require.NoError(t, writeUserRecoveryCodesOp(&c, domain.UserRecoveryCodesOp{
			Kind: domain.UserRecoveryCodesOpResetFailedAttempts,
		}))
		assert.Equal(t, "failed_attempts = $1", c.String())
		assert.Equal(t, []any{int16(0)}, c.args)
	})
}
