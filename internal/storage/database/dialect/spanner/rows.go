package spanner

import (
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/pgxcommon"
)

type Row = pgxcommon.Row
type Rows = pgxcommon.Rows

func newRow(row pgx.Row) *Row     { return pgxcommon.NewRow(row, wrapError) }
func newRows(rows pgx.Rows) *Rows { return pgxcommon.NewRows(rows, wrapError) }
