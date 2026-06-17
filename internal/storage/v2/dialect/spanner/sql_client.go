package spanner

import (
	"context"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
)

// Rows matches [storagedb.Rows] for Spanner query results.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Close() error
	Err() error
}

// ConvertPlaceholders translates $1 placeholders to @p1 for go-sql-spanner.
func ConvertPlaceholders(sql string) string {
	return convertPlaceholders(sql)
}

// SQLClient adapts [storagedb.QueryExecutor] with placeholder conversion.
type SQLClient struct {
	storagedb.QueryExecutor
}

func (c SQLClient) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	return c.QueryExecutor.Query(ctx, ConvertPlaceholders(sql), args...)
}

func (c SQLClient) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	return c.QueryExecutor.Exec(ctx, ConvertPlaceholders(sql), args...)
}
