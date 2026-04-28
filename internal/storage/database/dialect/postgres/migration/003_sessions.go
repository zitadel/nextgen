package migration

import (
	_ "embed"
)

var (
	//go:embed 003_sessions/up.sql
	up003Sessions string
	//go:embed 003_sessions/down.sql
	down003Sessions string
)

func init() {
	registerSQLMigration(up003Sessions, down003Sessions)
}
