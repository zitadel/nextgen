package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const pgTableFlowDefinitions = "zitadel_nextgen.flow_definitions"
const spannerTableFlowDefinitions = "flow_definitions"

// flowDefinitionRow is a private scan target for queries against the flow_definitions table.
// Nested data (purposes, audience, steps) lives in the JSONB definition column and is
// decoded by rowToFlowDefinition after scanning.
type flowDefinitionRow struct {
	ProjectID     string                      `db:"project_id"`
	ID            string                      `db:"id"`
	Name          string                      `db:"name"`
	SchemaVersion string                      `db:"schema_version"`
	Status        domain.FlowDefinitionStatus `db:"status"`
	Definition    JSON[flowDefinitionContent] `db:"definition"`
	CreatedAt     time.Time                   `db:"created_at"`
	UpdatedAt     time.Time                   `db:"updated_at"`
}

// flowDefinitionContent is the structure stored inside the definition JSONB column.
type flowDefinitionContent struct {
	UserSchema string                      `json:"user_schema"`
	Purposes   []flowDefinitionPurposeJSON `json:"purposes"`
	Audience   flowDefinitionAudienceJSON  `json:"audience"`
	Steps      []flowDefinitionStepJSON    `json:"steps"`
}

type flowDefinitionPurposeJSON struct {
	Purpose     string `json:"purpose"`
	InitialStep string `json:"initial_step"`
}

type flowDefinitionAudienceJSON struct {
	AppIDs  []string `json:"app_ids,omitempty"`
	TeamIDs []string `json:"team_ids,omitempty"`
}

type flowDefinitionStepJSON struct {
	Name        string                   `json:"name"`
	Fields      []string                 `json:"fields,omitempty"`
	OnSuccess   *string                  `json:"on_success,omitempty"`
	Complete    *string                  `json:"complete,omitempty"`
	Transitions []flowStepTransitionJSON `json:"transitions"`
}

type flowStepTransitionJSON struct {
	Action *string `json:"action"`
	Target string  `json:"target,omitempty"`
}

type flowDefinitionMeta struct {
	tableName string
}

func (m flowDefinitionMeta) PrimaryKeyColumns() []database.Column {
	return []database.Column{
		database.NewColumn(m.tableName, "project_id"),
		database.NewColumn(m.tableName, "id"),
	}
}

func (m flowDefinitionMeta) UpdatedAtColumn() database.Column {
	return database.NewColumn(m.tableName, "updated_at")
}

func (m flowDefinitionMeta) qualifiedTableName() string { return m.tableName }

// FlowDefinitionRepository implements [domain.FlowDefinitionRepository]
// using a single table where all nested data lives in a JSON/JSONB column.
type FlowDefinitionRepository struct {
	meta             flowDefinitionMeta
	statusCast       string                       // SQL cast suffix, e.g. "::zitadel_nextgen.flow_definition_states" (empty for Spanner)
	purposeElemCast  string                       // SQL cast suffix for a single element, e.g. "::zitadel_nextgen.flow_definition_purposes"
	purposeArrCast   string                       // SQL cast suffix for an array, e.g. "::zitadel_nextgen.flow_definition_purposes[]"
	encodePurposes   func([]string) any           // returns []string for Spanner, StringArray for Postgres
	encodeDefinition func([]byte) any             // returns string for Spanner (JSON column), []byte for Postgres (JSONB)
	now              database.Instruction         // NOW() for Postgres, CURRENT_TIMESTAMP() for Spanner
	arrayContains    func(val, col string) string // produces "val = ANY(col)" or "val IN UNNEST(col)"
}

// NewFlowDefinitionRepository returns a repository configured for either Spanner or Postgres
// based on the client type.
func NewFlowDefinitionRepository(client database.QueryExecutor) *FlowDefinitionRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return &FlowDefinitionRepository{
			meta:             flowDefinitionMeta{tableName: spannerTableFlowDefinitions},
			encodePurposes:   func(s []string) any { return s },
			encodeDefinition: func(b []byte) any { return string(b) },
			now:              database.CurrentTimestampInstruction,
			arrayContains:    func(val, col string) string { return val + " IN UNNEST(" + col + ")" },
		}
	case postgres.PostgresPooler:
		return &FlowDefinitionRepository{
			meta:             flowDefinitionMeta{tableName: pgTableFlowDefinitions},
			statusCast:       "::zitadel_nextgen.flow_definition_states",
			purposeElemCast:  "::zitadel_nextgen.flow_definition_purposes",
			purposeArrCast:   "::zitadel_nextgen.flow_definition_purposes[]",
			encodePurposes:   func(s []string) any { return StringArray(s) },
			encodeDefinition: func(b []byte) any { return b },
			now:              database.NowInstruction,
			arrayContains:    func(val, col string) string { return val + " = ANY(" + col + ")" },
		}
	}
	panic("NewFlowDefinitionRepository: unsupported client type")
}

var _ domain.FlowDefinitionRepository = (*FlowDefinitionRepository)(nil)

func (r *FlowDefinitionRepository) CreateFlowDefinition(ctx context.Context, client database.QueryExecutor, def *domain.FlowDefinition) error {
	content, err := marshalFlowDefinitionContent(def)
	if err != nil {
		return err
	}

	purposeStrs := make([]string, len(def.Purposes))
	for i, p := range def.Purposes {
		purposeStrs[i] = p.Purpose.String()
	}

	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at) VALUES (")
	b.WriteArgs(def.ProjectID, def.ID, def.Name, def.SchemaVersion)
	b.WriteString(", ")
	b.WriteString(b.AppendArg(def.Status.String()) + r.statusCast)
	b.WriteString(", ")
	b.WriteString(b.AppendArg(r.encodePurposes(purposeStrs)) + r.purposeArrCast)
	b.WriteString(", ")
	b.WriteArgs(r.encodeDefinition(content), r.now, r.now)
	b.WriteString(")")

	_, err = client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *FlowDefinitionRepository) GetFlowDefinition(ctx context.Context, client database.QueryExecutor, projectID, id string) (*domain.FlowDefinition, error) {
	b := database.NewStatementBuilder(
		"SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND id = ")
	b.WriteArg(id)

	row, err := getOne[flowDefinitionRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return rowToFlowDefinition(*row)
}

func (r *FlowDefinitionRepository) ListFlowDefinitions(ctx context.Context, client database.QueryExecutor, projectID string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
	o := domain.ApplyFlowDefinitionListOptions(opts)

	b := database.NewStatementBuilder(
		"SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)

	if o.Name != nil {
		b.WriteString(" AND name = ")
		b.WriteArg(*o.Name)
	}

	if o.Status != nil {
		b.WriteString(" AND status = ")
		b.WriteString(b.AppendArg(o.Status.String()) + r.statusCast)
	}
	if o.Purpose != nil {
		b.WriteString(" AND ")
		placeholder := b.AppendArg(o.Purpose.String()) + r.purposeElemCast
		b.WriteString(r.arrayContains(placeholder, "purposes"))
	}

	if o.SchemaVersion != nil {
		b.WriteString(" AND schema_version = ")
		b.WriteString(b.AppendArg(o.SchemaVersion))
	}

	b.WriteString(" ORDER BY created_at ASC, id ASC")

	if o.Limit > 0 {
		b.WriteString(" LIMIT ")
		b.WriteArg(o.Limit)
	}
	if o.Offset > 0 {
		b.WriteString(" OFFSET ")
		b.WriteArg(o.Offset)
	}
	rows, err := getMany[flowDefinitionRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return rowsToFlowDefinitions(rows)
}

func (r *FlowDefinitionRepository) UpdateFlowDefinitionStatus(ctx context.Context, client database.QueryExecutor, projectID, id string, status domain.FlowDefinitionStatus) error {
	t := r.meta.tableName
	condition := database.And(
		database.NewTextCondition(database.NewColumn(t, "project_id"), database.TextOperationEqual, projectID),
		database.NewTextCondition(database.NewColumn(t, "id"), database.TextOperationEqual, id),
	)
	_, err := updateOne(ctx, client, r.meta, condition,
		database.NewChange(database.NewColumn(t, "status"), status.String()),
		database.NewChange(database.NewColumn(t, "updated_at"), r.now),
	)
	return err
}

func (r *FlowDefinitionRepository) DeleteFlowDefinition(ctx context.Context, client database.QueryExecutor, projectID, id string) error {
	t := r.meta.tableName
	condition := database.And(
		database.NewTextCondition(database.NewColumn(t, "project_id"), database.TextOperationEqual, projectID),
		database.NewTextCondition(database.NewColumn(t, "id"), database.TextOperationEqual, id),
	)
	_, err := deleteOne(ctx, client, r.meta, condition)
	return err
}

// marshalFlowDefinitionContent converts the domain aggregate's nested fields
// into a JSON byte slice ready for the definition column.
func marshalFlowDefinitionContent(def *domain.FlowDefinition) ([]byte, error) {
	purposes := make([]flowDefinitionPurposeJSON, len(def.Purposes))
	for i, p := range def.Purposes {
		purposes[i] = flowDefinitionPurposeJSON{
			Purpose:     p.Purpose.String(),
			InitialStep: p.InitialStep,
		}
	}

	audience := flowDefinitionAudienceJSON{
		AppIDs:  def.Audience.AppIDs,
		TeamIDs: def.Audience.TeamIDs,
	}

	steps := make([]flowDefinitionStepJSON, len(def.Steps))
	for i, s := range def.Steps {
		transitions := make([]flowStepTransitionJSON, len(s.Transitions))
		for j, t := range s.Transitions {
			tr := flowStepTransitionJSON{Target: t.Target}
			if t.Action != nil {
				action := t.Action.String()
				tr.Action = &action
			}
			transitions[j] = tr
		}
		stepJSON := flowDefinitionStepJSON{
			Name:        s.Name,
			Fields:      s.Fields,
			Transitions: transitions,
		}
		if s.OnSuccess != nil {
			onSuccess := s.OnSuccess.String()
			stepJSON.OnSuccess = &onSuccess
		}
		if s.Complete != nil {
			complete := s.Complete.String()
			stepJSON.Complete = &complete
		}
		steps[i] = stepJSON
	}

	return json.Marshal(flowDefinitionContent{
		UserSchema: def.UserSchema,
		Purposes:   purposes,
		Audience:   audience,
		Steps:      steps,
	})
}

// rowToFlowDefinition converts a scanned flowDefinitionRow into the domain aggregate
// by parsing the JSONB definition column.
func rowToFlowDefinition(row flowDefinitionRow) (*domain.FlowDefinition, error) {
	content := row.Definition.Value

	purposes := make([]domain.FlowDefinitionPurposeEntry, len(content.Purposes))
	for i, p := range content.Purposes {
		purpose, err := domain.FlowDefinitionPurposeString(p.Purpose)
		if err != nil {
			return nil, err
		}
		purposes[i] = domain.FlowDefinitionPurposeEntry{
			Purpose:     purpose,
			InitialStep: p.InitialStep,
		}
	}

	steps := make([]domain.FlowDefinitionStep, len(content.Steps))
	for i, s := range content.Steps {
		transitions := make([]domain.FlowStepTransition, len(s.Transitions))
		for j, t := range s.Transitions {
			tr := domain.FlowStepTransition{Target: t.Target}
			if t.Action != nil {
				action, err := domain.FlowDefinitionTransitionActionString(*t.Action)
				if err != nil {
					return nil, err
				}
				tr.Action = &action
			}
			transitions[j] = tr
		}
		step := domain.FlowDefinitionStep{
			Name:        s.Name,
			Fields:      s.Fields,
			Transitions: transitions,
		}
		if s.OnSuccess != nil {
			onSuccess, err := domain.FlowOnSuccessString(*s.OnSuccess)
			if err != nil {
				return nil, err
			}
			step.OnSuccess = &onSuccess
		}
		if s.Complete != nil {
			complete, err := domain.FlowStepCompleteString(*s.Complete)
			if err != nil {
				return nil, err
			}
			step.Complete = &complete
		}
		steps[i] = step
	}

	return &domain.FlowDefinition{
		ProjectID:     row.ProjectID,
		ID:            row.ID,
		Name:          row.Name,
		SchemaVersion: row.SchemaVersion,
		Status:        row.Status,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
		UserSchema:    content.UserSchema,
		Purposes:      purposes,
		Audience: domain.FlowDefinitionAudience{
			AppIDs:  content.Audience.AppIDs,
			TeamIDs: content.Audience.TeamIDs,
		},
		Steps: steps,
	}, nil
}

func rowsToFlowDefinitions(rows []*flowDefinitionRow) ([]*domain.FlowDefinition, error) {
	defs := make([]*domain.FlowDefinition, len(rows))
	for i, row := range rows {
		def, err := rowToFlowDefinition(*row)
		if err != nil {
			return nil, err
		}
		defs[i] = def
	}
	return defs, nil
}
