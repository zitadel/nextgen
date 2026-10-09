package pagination

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"slices"

	"github.com/zitadel/zitadel/v5/internal/storage/database"
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

// Page runs one keyset page: run fetches the requested limit plus a look-ahead
// probe row, and Page trims the probe and returns the rows to serve with the
// next-page token. Page owns the +1 and the trim. A token is emitted only when
// the probe proves a further page exists, so an exact-multiple final page
// reports none (#849). limit 0 is unbounded; with no OrderBy there is no keyset
// to resume, so Page skips the probe and emits no token.
func Page[F ~uint8, T any](
	p database.Page[F],
	schema database.Schema[F, T],
	run func(limit uint32) ([]*T, error),
) ([]*T, []byte, error) {
	// Only an ordered page can resume via a token, so only it needs the probe.
	// At the uint32 maximum limit+1 is unrepresentable, but no result set holds
	// 2^32 rows, so that page has no successor and emitting no token is correct.
	fetch := p.Limit
	if len(p.OrderBy.Columns) > 0 && fetch != 0 && fetch != math.MaxUint32 {
		fetch++
	}
	items, err := run(fetch)
	if err != nil {
		return nil, nil, err
	}
	if p.Limit == 0 || uint64(len(items)) <= uint64(p.Limit) {
		return items, nil, nil
	}
	page := items[:p.Limit]
	token := New(p.OrderBy, schema.ValuesFrom(page[len(page)-1], p.OrderBy.Columns)).Marshal()
	return page, token, nil
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
