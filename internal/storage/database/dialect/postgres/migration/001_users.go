package migration

import (
	_ "embed"
)

var (
	//go:embed 001_users/up.sql
	up001Users string
	//go:embed 001_users/down.sql
	down001Users string
)

func init() {
	registerSQLMigration(up001Users, down001Users)
}
