package spanner

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func wrapError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return database.NewNoRowFoundError(err)
	}
	if errors.Is(err, pgx.ErrTooManyRows) {
		return database.NewMultipleRowsFoundError(err)
	}

	var pgxErr *pgconn.PgError
	if errors.As(err, &pgxErr) {
		return wrapPgError(pgxErr)
	}

	// scany only exports its errors as strings
	if strings.HasPrefix(err.Error(), "scany: expected 1 row, got: ") {
		return database.NewMultipleRowsFoundError(err)
	}
	if strings.HasPrefix(err.Error(), "scany:") || strings.HasPrefix(err.Error(), "scanning:") {
		return database.NewScanError(err)
	}

	return database.NewUnknownError(err)
}

func wrapPgError(err *pgconn.PgError) error {
	switch err.Code {
	case "23514":
		return database.NewCheckError(err.TableName, err.ConstraintName, err)
	case "23505":
		return database.NewUniqueError(err.TableName, err.ConstraintName, err)
	case "23503":
		return database.NewForeignKeyError(err.TableName, err.ConstraintName, err)
	case "23502":
		return database.NewNotNullError(err.TableName, err.ConstraintName, err)
	case "22P02":
		return database.NewCheckError(err.TableName, err.ConstraintName, err)
	default:
		return database.NewUnknownError(err)
	}
}
