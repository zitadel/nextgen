package migration

import _ "embed"

var (
	//go:embed 002_flow_definitions/up.sql
	up002FlowDefinitions string
	//go:embed 002_flow_definitions/down.sql
	down002FlowDefinitions string
)

func init() {
	registerSQLMigration(up002FlowDefinitions, down002FlowDefinitions)
}
