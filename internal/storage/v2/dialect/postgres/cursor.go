package postgres

import (
	"encoding/base64"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type pageCursor struct {
	// Columns of the previous order by clause.
	// They are used to determine if the [database.Page.OrderBy] has changed and if the cursor is still valid.
	Columns []database.Column
	// Values of the last row of the page. They are used to determine the next page of results.
	Values []any
}

func (c *pageCursor) Marshal() []byte {
	payload, err := json.Marshal(c)
	if err != nil {
		panic(err)
	}
	return []byte(base64.RawURLEncoding.EncodeToString(payload))
}

func cursorFromToken(token []byte) (*pageCursor, error) {
	var c pageCursor
	decoded, err := base64.RawURLEncoding.DecodeString(string(token))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(decoded, &c); err != nil {
		return nil, err
	}
	return &c, nil
}
