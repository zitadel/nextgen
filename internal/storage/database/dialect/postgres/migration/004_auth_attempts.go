package migration

import (
	_ "embed"
)

var (
	//go:embed 004_auth_attempts/up.sql
	up004AuthAttempts string
	//go:embed 004_auth_attempts/down.sql
	down004AuthAttempts string
)

func init() {
	registerSQLMigration(up004AuthAttempts, down004AuthAttempts)
}
