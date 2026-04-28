package migration

import (
	_ "embed"
)

var (
	//go:embed 003_users/up.sql
	up003Users string
	//go:embed 003_users/down.sql
	down003Users string
)

func init() {
	registerSQLMigration(up003Users, down003Users)
}
