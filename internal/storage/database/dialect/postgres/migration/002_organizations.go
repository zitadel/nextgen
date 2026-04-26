package migration

import (
	_ "embed"
)

var (
	//go:embed 002_organizations/up.sql
	up002Organizations string
	//go:embed 002_organizations/down.sql
	down002Organizations string
)

func init() {
	registerSQLMigration(up002Organizations, down002Organizations)
}
