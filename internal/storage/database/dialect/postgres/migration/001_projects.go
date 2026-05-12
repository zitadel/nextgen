package migration

import (
	_ "embed"
)

var (
	//go:embed 001_projects/up.sql
	up001Projects string
	//go:embed 001_projects/down.sql
	down001Projects string
)

func init() {
	registerSQLMigration(up001Projects, down001Projects)
}
