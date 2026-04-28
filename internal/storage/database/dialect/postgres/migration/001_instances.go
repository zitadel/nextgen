package migration

import (
	_ "embed"
)

var (
	//go:embed 001_instances/up.sql
	up001Instances string
	//go:embed 001_instances/down.sql
	down001Instances string
)

func init() {
	registerSQLMigration(up001Instances, down001Instances)
}
