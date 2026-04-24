package migration

import _ "embed"

var (
	//go:embed 003_flow_definitions_jsonb/up.sql
	up003FlowDefinitionsJSONB string
	//go:embed 003_flow_definitions_jsonb/down.sql
	down003FlowDefinitionsJSONB string
)

func init() {
	registerSQLMigration(up003FlowDefinitionsJSONB, down003FlowDefinitionsJSONB)
}
