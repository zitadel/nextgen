package migration

import (
	_ "embed"
)

var (
	//go:embed 005_sessions/up.sql
	up005Sessions string
	//go:embed 005_sessions/down.sql
	down005Sessions string
)

func init() {
	registerSQLMigration(up005Sessions, down005Sessions)
}
