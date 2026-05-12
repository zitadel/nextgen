// Package migration holds DDL migration statements for the Cloud Spanner dialect.
//
// To apply migrations, use the Cloud Spanner Database Admin client
// (cloud.google.com/go/spanner/admin/database/apiv1) to execute the DDL
// statements in [Migrations] in order. Each entry's Up field contains the
// statements for applying a migration; Down contains the rollback statements.
//
// Example (pseudocode):
//
//	adminClient.UpdateDatabaseDdl(ctx, &adminpb.UpdateDatabaseDdlRequest{
//	    Database:   dbName,
//	    Statements: splitStatements(Migrations[i].Up),
//	})
package migration

// Migration holds the up and down DDL for a single migration step.
type Migration struct {
	Up   string
	Down string
}

// Migrations contains all DDL migration statements in order.
// Add the Cloud Spanner Go SDK (cloud.google.com/go/spanner) to go.mod
// before wiring up a real migration runner.
var Migrations []*Migration

func registerMigration(up, down string) {
	Migrations = append(Migrations, &Migration{Up: up, Down: down})
}
