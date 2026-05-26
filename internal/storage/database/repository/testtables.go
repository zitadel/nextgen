package repository

import (
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

// TestTableNames holds dialect-qualified table names for integration tests.
type TestTableNames struct {
	Checks, Sessions, AuthAttempts string
}

// TestTableNamesFor returns table names for the pool dialect.
func TestTableNamesFor(pool database.QueryExecutor) TestTableNames {
	switch pool.(type) {
	case spanner.SpannerPooler:
		return TestTableNames{
			Checks:       spannerTableChecks,
			Sessions:     spannerTableSessions,
			AuthAttempts: spannerTableAuthAttempts,
		}
	case postgres.PostgresPooler:
		return TestTableNames{
			Checks:       pgTableChecks,
			Sessions:     pgTableSessions,
			AuthAttempts: pgTableAuthAttempts,
		}
	default:
		panic("TestTableNamesFor: unsupported pool type")
	}
}
