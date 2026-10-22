package spanner

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

func TestTokenSchema_CursorPreservesOpaqueStringIDs(t *testing.T) {
	t.Parallel()

	// Prefixed opaque IDs (and any decimal-looking bodies) must stay strings through
	// JSON cursor round-trip so float64 mantissa never corrupts them.
	const tokenID = "tkn_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C"
	sess := "sess_9007199254740993"
	tok := &domain.Token{
		TokenID:   tokenID,
		SessionID: &sess,
	}

	cols := []database.Column[domain.TokenField]{
		database.Col(domain.TokenFieldTokenID),
		database.Col(domain.TokenFieldSessionID),
	}
	values := tokenSchema.ValuesFrom(tok, cols)
	require.Len(t, values, 2)
	assert.IsType(t, "", values[0], "token_id accessor must return a string for JSON-safe cursors")
	assert.Equal(t, tokenID, values[0])
	assert.Equal(t, sess, values[1])

	cursor := &pagination.Cursor[domain.TokenField]{Columns: cols, Values: values}
	decoded, err := pagination.CursorFromToken[domain.TokenField](cursor.Marshal())
	require.NoError(t, err)

	coerced, err := tokenSchema.CoerceCursorValues(decoded.Columns, decoded.Values)
	require.NoError(t, err)
	require.Len(t, coerced, 2)
	assert.Equal(t, tokenID, coerced[0])
	assert.Equal(t, sess, coerced[1])
}

func TestTokenSchema_CursorRejectsJSONFloatIDs(t *testing.T) {
	t.Parallel()

	cols := []database.Column[domain.TokenField]{
		database.Col(domain.TokenFieldTokenID),
	}
	_, err := tokenSchema.CoerceCursorValues(cols, []any{float64(math.MaxInt64)})
	require.Error(t, err)
}
