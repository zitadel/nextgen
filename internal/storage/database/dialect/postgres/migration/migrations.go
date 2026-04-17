package migration

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/tern/v2/migrate"
)

var migrations []*migrate.Migration

const SCHEMA_NAME = "zitadel_nextgen"

func Migrate(ctx context.Context, conn *pgx.Conn) error {
	_, err := conn.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS "+SCHEMA_NAME)
	if err != nil {
		return err
	}
	migrator, err := migrate.NewMigrator(ctx, conn, fmt.Sprintf("%s.migrations", SCHEMA_NAME))
	if err != nil {
		return err
	}
	migrator.Migrations = migrations
	return migrator.Migrate(ctx)
}

func registerSQLMigration(up, down string) {
	migID := len(migrations) + 1
	migrations = append(migrations, &migrate.Migration{
		Sequence: int32(migID),
		UpSQL:    up,
		DownSQL:  down,
	})
}
