package migration

import (
	_ "embed"
)

var (
	//go:embed 004_users/up.sql
	up004Users string
	//go:embed 004_users/down.sql
	down004Users string
)

func init() {
	registerSQLMigration(up004Users, down004Users)
}
