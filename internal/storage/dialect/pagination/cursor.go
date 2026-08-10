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
	// Values of the last row of the page. They are used to determine the next page of results.
	Values []any `json:"values"`
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

func (c *Cursor[F]) MatchesOrderBy(columns []database.Column[F]) bool {
	if len(c.Columns) != len(columns) {
		return false
	}
	return slices.Equal(c.Columns, columns)
}
