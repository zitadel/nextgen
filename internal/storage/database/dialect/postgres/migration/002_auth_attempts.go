package migration

import (
	_ "embed"
)

var (
	//go:embed 002_auth_attempts/up.sql
	up002AuthAttempts string
	//go:embed 002_auth_attempts/down.sql
	down002AuthAttempts string
)

func init() {
	registerSQLMigration(up002AuthAttempts, down002AuthAttempts)
}
