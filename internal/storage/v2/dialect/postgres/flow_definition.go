package postgres

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/flowdefinition"
)

const (
	statusCast      = "::zitadel_nextgen.flow_definition_states"
	purposeElemCast = "::zitadel_nextgen.flow_definition_purposes"
	purposeArrCast  = "::zitadel_nextgen.flow_definition_purposes[]"

	createFlowDefinitionStmt = `INSERT INTO zitadel_nextgen.flow_definitions ` +
		`(project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at) ` +
		`VALUES ($1, $2, $3, $4, $5` + statusCast + `, $6` + purposeArrCast + `, $7, NOW(), NOW())`

	deleteFlowDefinitionStmt = `DELETE FROM zitadel_nextgen.flow_definitions WHERE project_id = $1 AND id = $2`

	updateFlowDefinitionStmt = `UPDATE zitadel_nextgen.flow_definitions SET ` +
		`name = $1, schema_version = $2, status = $3` + statusCast + `, purposes = $4` + purposeArrCast + `, ` +
		`definition = $5, updated_at = NOW() WHERE project_id = $6 AND id = $7`

	flowDefinitionQuery = `SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at ` +
		`FROM zitadel_nextgen.flow_definitions`
)

type flowDefinitionStatements struct{ statement }

func newFlowDefinitionStatements(client queryExecutor) flowDefinitionStatements {
	return flowDefinitionStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateFlowDefinition implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	purposes := flowdefinition.PurposeStrings(entity)
	_, err = f.client.Exec(ctx, createFlowDefinitionStmt,
		entity.ProjectID,
		entity.ID,
		entity.Name,
		entity.SchemaVersion,
		entity.Status.String(),
		purposes,
		content,
	)
	return wrapError(err)
}

// GetFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) GetFlowDefinitionByID(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, flowDefinitionQuery, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
			database.Equal(database.Col(domain.FlowDefinitionFieldID), id),
		),
	}, flowDefinitionSchema); err != nil {
		return nil, err
	}

	rows, err := f.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	def, err := pgx.CollectExactlyOneRow(rows, f.scanFlowDefinition)
	if err != nil {
		return nil, wrapError(err)
	}
	return def, nil
}

// UpdateFlowDefinition implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) UpdateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	purposes := flowdefinition.PurposeStrings(entity)
	_, err = f.client.Exec(ctx, updateFlowDefinitionStmt,
		entity.Name,
		entity.SchemaVersion,
		entity.Status.String(),
		purposes,
		content,
		entity.ProjectID,
		entity.ID,
	)
	return wrapError(err)
}

// ListFlowDefinitions implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
	if filter == nil {
		filter = &database.ListOptions[domain.FlowDefinitionField]{}
	}
	opts := *filter
	if len(opts.Pagination.OrderBy.Columns) == 0 {
		opts.Pagination.OrderBy = database.OrderBy[domain.FlowDefinitionField]{
			Columns: []database.Column[domain.FlowDefinitionField]{
				database.Col(domain.FlowDefinitionFieldCreatedAt),
				database.Col(domain.FlowDefinitionFieldID),
			},
			Direction: database.OrderDesc,
		}
	}

	purposeValue, remaining := extractPurposeContains(opts.Filter)
	opts.Filter = remaining

	var compiler statementCompiler
	if err := compileFlowDefinitionList(&compiler, &opts, purposeValue); err != nil {
		return nil, err
	}

	rows, err := f.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defs, err := pgx.CollectRows(rows, f.scanFlowDefinition)
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if opts.Pagination.Limit > 0 && len(defs) == int(opts.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.FlowDefinitionField]{
			Columns: opts.Pagination.OrderBy.Columns,
			Values:  flowDefinitionSchema.ValuesFrom(defs[len(defs)-1], opts.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.FlowDefinition]{
		Items:      defs,
		NextCursor: nextCursor,
	}, nil
}

func compileFlowDefinitionList(c *statementCompiler, opt *database.ListOptions[domain.FlowDefinitionField], purposeValue string) error {
	c.WriteString(flowDefinitionQuery)

	filter := opt.Filter
	if len(opt.Pagination.Cursor) != 0 {
		cursor, err := pagination.CursorFromToken[domain.FlowDefinitionField](opt.Pagination.Cursor)
		if err != nil {
			return database.ErrInvalidCursor()
		}
		if !cursor.MatchesOrderBy(opt.Pagination.OrderBy.Columns) {
			return database.ErrCursorOrderMismatch()
		}
		values, err := flowDefinitionSchema.CoerceCursorValues(cursor.Columns, cursor.Values)
		if err != nil {
			return database.ErrInvalidCursor().WithParent(err)
		}
		terms := compareTerms(cursor.Columns, values)
		if opt.Pagination.OrderBy.Direction == database.OrderAsc {
			filter = database.And(filter, database.CompareGreater(terms...))
		} else {
			filter = database.And(filter, database.CompareLess(terms...))
		}
	}

	if filter != nil || purposeValue != "" {
		c.WriteString(" WHERE ")
		if filter != nil {
			compileFilter(c, filter, flowDefinitionSchema)
			if purposeValue != "" {
				c.WriteString(" AND ")
			}
		}
		if purposeValue != "" {
			placeholder := "$" + strconv.Itoa(len(c.args)+1) + purposeElemCast
			c.args = append(c.args, purposeValue)
			c.WriteString(placeholder)
			c.WriteString(" = ANY(purposes)")
		}
	}

	compileOrderBy(c, opt.Pagination.OrderBy, flowDefinitionSchema)
	compileLimit(c, opt.Pagination.Limit)
	return nil
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	_, err := f.client.Exec(ctx, deleteFlowDefinitionStmt, projectID, id)
	return wrapError(err)
}

func (f flowDefinitionStatements) scanFlowDefinition(row pgx.CollectableRow) (*domain.FlowDefinition, error) {
	var (
		projectID, id, name, schemaVersion string
		status                             domain.FlowDefinitionStatus
		definition                         []byte
		createdAt, updatedAt               time.Time
	)
	if err := row.Scan(&projectID, &id, &name, &schemaVersion, &status, &definition, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, status, createdAt, updatedAt, definition)
}

func extractPurposeContains(filter database.Filter[domain.FlowDefinitionField]) (purpose string, remaining database.Filter[domain.FlowDefinitionField]) {
	if filter == nil {
		return "", nil
	}
	switch f := filter.(type) {
	case database.AndFilter[domain.FlowDefinitionField]:
		kept := make([]database.Filter[domain.FlowDefinitionField], 0, len(f.Filters))
		for _, child := range f.Filters {
			p, rest := extractPurposeContains(child)
			if p != "" {
				purpose = p
			}
			if rest != nil {
				kept = append(kept, rest)
			}
		}
		if len(kept) == 0 {
			return purpose, nil
		}
		if len(kept) == 1 {
			return purpose, kept[0]
		}
		return purpose, database.And(kept...)
	case *database.CompareFilter[domain.FlowDefinitionField]:
		if f.Op == database.OpEqual && len(f.Terms) == 1 && f.Terms[0].Column.Field() == domain.FlowDefinitionFieldPurposes {
			return purposeFilterValue(f.Terms[0].Value), nil
		}
		return "", f
	default:
		return "", filter
	}
}

func purposeFilterValue(v any) string {
	switch p := v.(type) {
	case string:
		return p
	case domain.FlowDefinitionPurpose:
		return p.String()
	case *domain.FlowDefinitionPurpose:
		if p == nil {
			return ""
		}
		return p.String()
	default:
		return ""
	}
}

// IsStatements implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) IsStatements() {}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)

func parseFlowDefinitionPurposeKey(s string) (domain.FlowDefinitionPurpose, error) {
	if purpose, err := domain.FlowDefinitionPurposeString(s); err == nil {
		return purpose, nil
	}
	n, err := strconv.ParseUint(s, 10, 8)
	if err != nil {
		return 0, database.ErrInvalidEnumKey(s)
	}
	return domain.FlowDefinitionPurpose(n), nil
}

var flowDefinitionSchema = database.NewSchema(map[domain.FlowDefinitionField]database.FieldBinding[domain.FlowDefinition]{
	domain.FlowDefinitionFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldID: {
		SQLName:  "id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ID },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldName: {
		SQLName:  "name",
		Accessor: func(d *domain.FlowDefinition) any { return d.Name },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldSchemaVersion: {
		SQLName:  "schema_version",
		Accessor: func(d *domain.FlowDefinition) any { return d.SchemaVersion },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldStatus: {
		SQLName:  "status",
		Accessor: func(d *domain.FlowDefinition) any { return d.Status },
		Coerce:   database.CoerceNumber[domain.FlowDefinitionStatus],
	},
	domain.FlowDefinitionFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.FlowDefinitionFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.FlowDefinitionFieldUserSchema: {
		SQLName:  "user_schema",
		Accessor: func(d *domain.FlowDefinition) any { return d.UserSchema },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldPurposes: {
		SQLName:  "purposes",
		Accessor: func(d *domain.FlowDefinition) any { return d.Purposes },
		Coerce:   database.CoerceEnumKeyMapAsAny[domain.FlowDefinitionPurpose, string](parseFlowDefinitionPurposeKey),
	},
	domain.FlowDefinitionFieldAudience: {
		SQLName:  "audience",
		Accessor: func(d *domain.FlowDefinition) any { return d.Audience },
		Coerce:   database.CoerceJSON[domain.FlowDefinitionAudience],
	},
	domain.FlowDefinitionFieldSteps: {
		SQLName:  "steps",
		Accessor: func(d *domain.FlowDefinition) any { return d.Steps },
		Coerce:   database.CoerceSliceAsAny(database.CoerceJSONValue[domain.FlowDefinitionStep]),
	},
})
