package pagination

import (
	"encoding/base64"
	"encoding/json"
	"slices"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type Cursor[F ~uint8] struct {
	// Columns of the previous order by clause.
	// They are used to determine if the [database.Page.OrderBy] has changed and if the cursor is still valid.
	Columns []database.Column[F] `json:"columns"`
	// Direction of the previous order by clause. A direction change invalidates the cursor.
	// JSON omission unmarshals as 0 (OrderAsc): pre-direction tokens are treated as ASC (hard cutover).
	Direction database.OrderDirection `json:"direction"`
	// Values of the last row of the page. They are used to determine the next page of results.
	Values []any `json:"values"`
}

// New builds a keyset cursor from the active OrderBy and the last row's sort values.
func New[F ~uint8](orderBy database.OrderBy[F], values []any) *Cursor[F] {
	return &Cursor[F]{
		Columns:   orderBy.Columns,
		Direction: orderBy.Direction,
		Values:    values,
	}
}

// MarshalNext returns a marshaled keyset cursor when the page is full and OrderBy
// has at least one column; otherwise nil. Empty OrderBy never emits a token.
func MarshalNext[F ~uint8, T any](
	orderBy database.OrderBy[F],
	items []*T,
	schema database.Schema[F, T],
	limit uint32,
) []byte {
	if limit == 0 || len(items) != int(limit) || len(orderBy.Columns) == 0 {
		return nil
	}
	return New(orderBy, schema.ValuesFrom(items[len(items)-1], orderBy.Columns)).Marshal()
}

func CursorFromToken[F ~uint8](token []byte) (*Cursor[F], error) {
	var c Cursor[F]
	decoded, err := base64.RawURLEncoding.DecodeString(string(token))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(decoded, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func (c *Cursor[F]) Marshal() []byte {
	payload, err := json.Marshal(c)
	if err != nil {
		// This should never happen, as the Cursor struct is simple and should always be serializable.
		panic(err)
	}
	return []byte(base64.RawURLEncoding.EncodeToString(payload))
}

// MatchesOrderBy reports whether the cursor was issued for the same columns and direction.
// Empty column sets never match: a zero-term keyset would compile to invalid SQL.
func (c *Cursor[F]) MatchesOrderBy(orderBy database.OrderBy[F]) bool {
	if len(c.Columns) == 0 {
		return false
	}
	if c.Direction != orderBy.Direction {
		return false
	}
	if len(c.Columns) != len(orderBy.Columns) {
		return false
	}
	return slices.Equal(c.Columns, orderBy.Columns)
}
