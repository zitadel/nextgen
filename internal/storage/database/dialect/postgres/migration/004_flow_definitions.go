package migration

import _ "embed"

var (
	//go:embed 004_flow_definitions/up.sql
	up004FlowDefinitions string
	//go:embed 004_flow_definitions/down.sql
	down004FlowDefinitions string
)

func init() {
	registerSQLMigration(up004FlowDefinitions, down004FlowDefinitions)
}
