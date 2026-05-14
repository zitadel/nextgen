package spanner

import (
	"database/sql"

	"github.com/georgysavva/scany/v2/sqlscan"

	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	_ database.Row             = (*Row)(nil)
	_ database.Rows            = (*Rows)(nil)
	_ database.CollectableRows = (*Rows)(nil)
)

type Row struct {
	row *sql.Row
}

func newRow(row *sql.Row) *Row {
	return &Row{row: row}
}

func (r *Row) Scan(dest ...any) error {
	return wrapError(r.row.Scan(dest...))
}

type Rows struct {
	rows *sql.Rows
}

func newRows(rows *sql.Rows) *Rows {
	return &Rows{rows: rows}
}

func (r *Rows) Next() bool { return r.rows.Next() }

func (r *Rows) Close() error { return wrapError(r.rows.Close()) }

func (r *Rows) Err() error { return wrapError(r.rows.Err()) }

func (r *Rows) Scan(dest ...any) error { return wrapError(r.rows.Scan(dest...)) }

func (r *Rows) Collect(dest any) (err error) {
	defer func() {
		closeErr := r.Close()
		if err == nil {
			err = closeErr
		}
	}()
	return wrapError(sqlscan.ScanAll(dest, r.rows))
}

func (r *Rows) CollectFirst(dest any) (err error) {
	defer func() {
		closeErr := r.Close()
		if err == nil {
			err = closeErr
		}
	}()
	return wrapError(sqlscan.ScanRow(dest, r.rows))
}

func (r *Rows) CollectExactlyOneRow(dest any) (err error) {
	defer func() {
		closeErr := r.Close()
		if err == nil {
			err = closeErr
		}
	}()
	return wrapError(sqlscan.ScanOne(dest, r.rows))
}
