package spanner

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

func TestTokenSchema_CursorPreservesLargeInt64IDs(t *testing.T) {
	t.Parallel()

	// BIT_REVERSED_POSITIVE IDs routinely exceed float64 mantissa precision.
	const largeID = "9223372036854775807" // math.MaxInt64
	sess := "9007199254740993"            // 2^53 + 1
	tok := &domain.Token{
		TokenID:   largeID,
		SessionID: &sess,
	}

	cols := []database.Column[domain.TokenField]{
		database.Col(domain.TokenFieldTokenID),
		database.Col(domain.TokenFieldSessionID),
	}
	values := tokenSchema.ValuesFrom(tok, cols)
	require.Len(t, values, 2)
	assert.IsType(t, "", values[0], "token_id accessor must return a string for JSON-safe cursors")
	assert.Equal(t, largeID, values[0])
	assert.Equal(t, sess, values[1])

	cursor := &pagination.Cursor[domain.TokenField]{Columns: cols, Values: values}
	decoded, err := pagination.CursorFromToken[domain.TokenField](cursor.Marshal())
	require.NoError(t, err)

	coerced, err := tokenSchema.CoerceCursorValues(decoded.Columns, decoded.Values)
	require.NoError(t, err)
	require.Len(t, coerced, 2)
	assert.Equal(t, int64(math.MaxInt64), coerced[0])
	assert.Equal(t, int64(9007199254740993), coerced[1])
}

func TestTokenSchema_CursorRejectsJSONFloatIDs(t *testing.T) {
	t.Parallel()

	cols := []database.Column[domain.TokenField]{
		database.Col(domain.TokenFieldTokenID),
	}
	_, err := tokenSchema.CoerceCursorValues(cols, []any{float64(math.MaxInt64)})
	require.Error(t, err)
}
