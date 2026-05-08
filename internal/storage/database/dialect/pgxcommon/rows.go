// Package pgxcommon provides Row, Rows, and Transaction wrappers shared by
// all pgx-based database dialect implementations (Postgres, Spanner via PGAdapter, …).
package pgxcommon

import (
	"github.com/georgysavva/scany/v2/pgxscan"
	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	_ database.Rows            = (*Rows)(nil)
	_ database.CollectableRows = (*Rows)(nil)
	_ database.Row             = (*Row)(nil)
)

// Row wraps pgx.Row and applies a dialect-specific error mapper.
type Row struct {
	pgx.Row
	wrapErr func(error) error
}

// NewRow creates a Row that applies wrapErr to any scan error.
func NewRow(row pgx.Row, wrapErr func(error) error) *Row {
	return &Row{Row: row, wrapErr: wrapErr}
}

// Scan implements [database.Row].
func (r *Row) Scan(dest ...any) error {
	return r.wrapErr(r.Row.Scan(dest...))
}

// Rows wraps pgx.Rows and applies a dialect-specific error mapper.
type Rows struct {
	pgx.Rows
	wrapErr func(error) error
}

// NewRows creates a Rows that applies wrapErr to any error.
func NewRows(rows pgx.Rows, wrapErr func(error) error) *Rows {
	return &Rows{Rows: rows, wrapErr: wrapErr}
}

// Err implements [database.Rows].
func (r *Rows) Err() error {
	return r.wrapErr(r.Rows.Err())
}

// Scan implements [database.Rows].
func (r *Rows) Scan(dest ...any) error {
	return r.wrapErr(r.Rows.Scan(dest...))
}

// Collect implements [database.CollectableRows].
func (r *Rows) Collect(dest any) (err error) {
	defer func() {
		closeErr := r.Close()
		if err == nil {
			err = closeErr
		}
	}()
	return r.wrapErr(pgxscan.ScanAll(dest, r.Rows))
}

// CollectFirst implements [database.CollectableRows].
func (r *Rows) CollectFirst(dest any) (err error) {
	defer func() {
		closeErr := r.Close()
		if err == nil {
			err = closeErr
		}
	}()
	return r.wrapErr(pgxscan.ScanRow(dest, r.Rows))
}

// CollectExactlyOneRow implements [database.CollectableRows].
func (r *Rows) CollectExactlyOneRow(dest any) (err error) {
	defer func() {
		closeErr := r.Close()
		if err == nil {
			err = closeErr
		}
	}()
	return r.wrapErr(pgxscan.ScanOne(dest, r.Rows))
}

// Close implements [database.Rows].
func (r *Rows) Close() error {
	r.Rows.Close()
	return nil
}
