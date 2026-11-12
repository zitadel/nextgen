//go:build spanner_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/dbtest"
	"github.com/zitadel/nextgen/internal/storage/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

func init() {
	// The emulator dbtest.Spanner starts otherwise runs one read-write
	// transaction at a time and aborts the rest.
	if !testdb.SpannerProvisions() && !testdb.SpannerSharesDatabase() {
		oneAtATime = true
	}
	registerDialect(
		"spanner",
		dbtest.Spanner,
		func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error {
			return spanner.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, teamID string) error {
			return spanner.HardDeleteTeam(ctx, pool, projectID, teamID)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, url string, objectType *string, createdAt time.Time) error {
			return spanner.InsertJSONSchemaAt(ctx, pool, projectID, url, objectType, createdAt)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, id, name string, createdAt time.Time) error {
			return spanner.InsertFlowDefinitionAt(ctx, pool, projectID, id, name, createdAt)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, id, userID, encodedHash string, createdAt time.Time) error {
			return spanner.InsertUserPasswordAt(ctx, pool, projectID, id, userID, encodedHash, createdAt)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, userID string) error {
			return spanner.ReactivateUser(ctx, pool, projectID, userID)
		},
		spanner.SchemaColumnNullability(),
		func(ctx context.Context, pool dbtest.Pool) (map[string]map[string]bool, error) {
			return spanner.LiveColumnNullability(ctx, pool)
		},
	)
}
