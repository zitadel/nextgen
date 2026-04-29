package migration

import (
	_ "embed"
)

var (
	//go:embed 003_json_schemas/up.sql
	up003JsonSchema string
	//go:embed 003_json_schemas/down.sql
	down003JsonSchema string
)

func init() {
	registerSQLMigration(up003JsonSchema, down003JsonSchema)
}
