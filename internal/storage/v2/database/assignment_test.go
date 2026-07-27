package database_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestBuildSetClause(t *testing.T) {
	t.Parallel()

	clause, args, next, err := database.BuildSetClause([]database.Assignment{
		{Column: "verified_at", Value: "t1"},
		{Column: "failed_attempts", Expr: "failed_attempts + 1"},
		{Column: "secret", Value: []byte{1}},
		{Column: "last_successful_check", Null: true},
		{Column: "sign_count", Expr: "sign_count + ?", ExprArgs: []any{int64(2)}},
	}, 3)
	require.NoError(t, err)
	assert.Equal(t, "verified_at = $3, failed_attempts = failed_attempts + 1, secret = $4, last_successful_check = NULL, sign_count = sign_count + $5", clause)
	assert.Equal(t, []any{"t1", []byte{1}, int64(2)}, args)
	assert.Equal(t, 6, next)

	_, _, _, err = database.BuildSetClause(nil, 1)
	assert.ErrorIs(t, err, database.ErrNoChanges)
	assert.ErrorIs(t, err, legacydb.ErrNoChanges)
}
