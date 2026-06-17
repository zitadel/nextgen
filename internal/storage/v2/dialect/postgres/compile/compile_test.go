package compile_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/compile"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
	"github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"
)

const selectFlowDefs = `SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at
FROM zitadel_nextgen.flow_definitions`

func TestCompileList_flowDefinitionExample(t *testing.T) {
	t.Parallel()

	cursorTime := time.Date(2026, 6, 10, 14, 30, 0, 0, time.UTC)
	opts := query.ListOptions[flowdefinition.Column]{
		Filter: query.And(
			query.TextEquals(flowdefinition.ColProjectID, "proj_abc"),
			query.EnumEquals(flowdefinition.ColStatus, "active"),
			query.FlowDefinitionPurposeContains{Purpose: "login"},
			query.TextEquals(flowdefinition.ColSchemaVersion, "1.0.0"),
		),
		OrderBy: []query.OrderBy[flowdefinition.Column]{
			{Column: flowdefinition.ColCreatedAt, Direction: query.OrderDesc},
			{Column: flowdefinition.ColID, Direction: query.OrderDesc},
		},
		Page: query.PageCursor[flowdefinition.Column]{
			After: query.NewFlowDefinitionCursor(cursorTime, "flow_prev"),
			Limit: 50,
		},
	}

	var c compile.Compiler
	compiled, err := c.CompileList(selectFlowDefs, opts)
	require.NoError(t, err)

	assert.Equal(t, []any{"proj_abc", "active", "login", "1.0.0", cursorTime, "flow_prev", uint32(50)}, compiled.Args)
	assert.Contains(t, compiled.SQL, "project_id = $1")
	assert.Contains(t, compiled.SQL, "status = $2::zitadel_nextgen.flow_definition_states")
	assert.Contains(t, compiled.SQL, "$3::zitadel_nextgen.flow_definition_purposes = ANY(")
	assert.Contains(t, compiled.SQL, "schema_version = $4")
	assert.Contains(t, compiled.SQL, "(zitadel_nextgen.flow_definitions.created_at, zitadel_nextgen.flow_definitions.id) < ($5, $6)")
	assert.Contains(t, compiled.SQL, "ORDER BY zitadel_nextgen.flow_definitions.created_at DESC, zitadel_nextgen.flow_definitions.id DESC")
	assert.Contains(t, compiled.SQL, "LIMIT $7")
}

func TestCompileList_offsetPagination(t *testing.T) {
	t.Parallel()

	opts := query.ListOptions[flowdefinition.Column]{
		Filter: query.TextEquals(flowdefinition.ColProjectID, "proj_page"),
		OrderBy: []query.OrderBy[flowdefinition.Column]{
			{Column: flowdefinition.ColCreatedAt, Direction: query.OrderDesc},
			{Column: flowdefinition.ColID, Direction: query.OrderDesc},
		},
		Page: query.PageLimit{Limit: 2, Offset: 2},
	}

	var c compile.Compiler
	compiled, err := c.CompileList(selectFlowDefs, opts)
	require.NoError(t, err)

	assert.Contains(t, compiled.SQL, "LIMIT $2")
	assert.Contains(t, compiled.SQL, "OFFSET $3")
}
