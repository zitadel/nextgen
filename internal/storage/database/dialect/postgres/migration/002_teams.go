package migration

import (
	_ "embed"
)

var (
	//go:embed 002_teams/up.sql
	up002Teams string
	//go:embed 002_teams/down.sql
	down002Teams string
)

func init() {
	registerSQLMigration(up002Teams, down002Teams)
}
