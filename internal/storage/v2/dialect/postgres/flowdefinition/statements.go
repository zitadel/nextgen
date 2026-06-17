package flowdefinition

import (
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/compile"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
	flowdefquery "github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"
)

const (
	createFlowDefinitionStmt = `INSERT INTO zitadel_nextgen.flow_definitions
(project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5::zitadel_nextgen.flow_definition_states, $6::zitadel_nextgen.flow_definition_purposes[], $7, NOW(), NOW())`

	getFlowDefinitionStmt = `SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at
FROM zitadel_nextgen.flow_definitions
WHERE project_id = $1 AND id = $2`

	updateStatusStmt = `UPDATE zitadel_nextgen.flow_definitions
SET status = $3::zitadel_nextgen.flow_definition_states, updated_at = NOW()
WHERE project_id = $1 AND id = $2`

	deleteFlowDefinitionStmt = `DELETE FROM zitadel_nextgen.flow_definitions WHERE project_id = $1 AND id = $2`
)

// Statements implements flow definition SQL for Postgres.
type Statements struct {
	client   storagedb.QueryExecutor
	compiler compile.Compiler
}

// NewStatements returns Postgres flow definition statements for the client.
func NewStatements(client storagedb.QueryExecutor) *Statements {
	return &Statements{client: client, compiler: compile.Compiler{}}
}

// Create implements [v2database.FlowDefinitionStatements].
func (s *Statements) Create(def *domain.FlowDefinition) v2database.Execution {
	content, err := MarshalContent(def)
	if err != nil {
		return errorExec(err)
	}
	purposeStrs := make([]string, 0, len(def.Purposes))
	for p := range def.Purposes {
		purposeStrs = append(purposeStrs, p.String())
	}
	return &execStmt{
		client: s.client,
		stmt:   createFlowDefinitionStmt,
		args: []any{
			def.ProjectID,
			def.ID,
			def.Name,
			def.SchemaVersion,
			def.Status.String(),
			StringArray(purposeStrs),
			content,
		},
	}
}

// GetByID implements [v2database.FlowDefinitionStatements].
func (s *Statements) GetByID(projectID, id string) v2database.Query[*domain.FlowDefinition] {
	return &queryStmt[*domain.FlowDefinition]{
		client: s.client,
		compile: func() (string, []any, error) {
			return getFlowDefinitionStmt, []any{projectID, id}, nil
		},
		scan: func(rows storagedb.Rows) (*domain.FlowDefinition, error) {
			if !rows.Next() {
				if err := rows.Err(); err != nil {
					return nil, err
				}
				return nil, storagedb.NewNoRowFoundError(pgx.ErrNoRows)
			}
			r, err := scanSQLRow(rows)
			if err != nil {
				return nil, err
			}
			return RowToDomain(r)
		},
	}
}

// List implements [v2database.FlowDefinitionStatements].
func (s *Statements) List(opts query.ListOptions[flowdefquery.Column]) v2database.Query[query.ListResult[*domain.FlowDefinition]] {
	return &queryStmt[query.ListResult[*domain.FlowDefinition]]{
		client: s.client,
		compile: func() (string, []any, error) {
			if err := query.RequireRestricts(opts.Filter, flowdefquery.ColProjectID); err != nil {
				return "", nil, err
			}
			compiled, err := s.compiler.CompileList(selectFlowDefinitionsSQL, opts)
			return compiled.SQL, compiled.Args, err
		},
		scan: func(rows storagedb.Rows) (query.ListResult[*domain.FlowDefinition], error) {
			items, err := scanSQLRows(rows)
			if err != nil {
				return query.ListResult[*domain.FlowDefinition]{}, err
			}
			var limit uint32
			switch page := opts.Page.(type) {
			case query.PageLimit:
				limit = page.Limit
			case query.PageCursor[flowdefquery.Column]:
				limit = page.Limit
			}
			return query.ListResult[*domain.FlowDefinition]{
				Items:      items,
				NextCursor: NextCursor(items, limit),
			}, nil
		},
	}
}

// UpdateStatus implements [v2database.FlowDefinitionStatements].
func (s *Statements) UpdateStatus(projectID, id string, status domain.FlowDefinitionStatus) v2database.Execution {
	return &execStmt{
		client: s.client,
		stmt:   updateStatusStmt,
		args:   []any{projectID, id, status.String()},
	}
}

// Delete implements [v2database.FlowDefinitionStatements].
func (s *Statements) Delete(projectID, id string) v2database.Execution {
	return &execStmt{
		client: s.client,
		stmt:   deleteFlowDefinitionStmt,
		args:   []any{projectID, id},
	}
}

var _ v2database.FlowDefinitionStatements = (*Statements)(nil)
