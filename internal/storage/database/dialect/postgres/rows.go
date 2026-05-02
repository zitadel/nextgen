package postgres

import (
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/pgxcommon"
)

// Row and Rows are type aliases so that callers that reference postgres.Row / postgres.Rows
// continue to compile without change.
type Row = pgxcommon.Row
type Rows = pgxcommon.Rows

func newRow(row pgx.Row) *Row { return pgxcommon.NewRow(row, wrapError) }

func newRows(rows pgx.Rows) *Rows { return pgxcommon.NewRows(rows, wrapError) }
