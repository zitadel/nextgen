package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const tableFlowDefinitions = "zitadel_nextgen.flow_definitions"

var (
	colFlowDefProjectID = database.NewColumn(tableFlowDefinitions, "project_id")
	colFlowDefID        = database.NewColumn(tableFlowDefinitions, "id")
	colFlowDefStatus    = database.NewColumn(tableFlowDefinitions, "status")
	colFlowDefUpdatedAt = database.NewColumn(tableFlowDefinitions, "updated_at")
)

type flowDefinition struct{}

func (flowDefinition) PrimaryKeyColumns() []database.Column {
	return []database.Column{colFlowDefProjectID, colFlowDefID}
}

func (flowDefinition) UpdatedAtColumn() database.Column { return colFlowDefUpdatedAt }

func (flowDefinition) qualifiedTableName() string { return tableFlowDefinitions }

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
	Purposes []flowDefinitionPurposeJSON `json:"purposes"`
	Audience flowDefinitionAudienceJSON  `json:"audience"`
	Steps    []flowDefinitionStepJSON    `json:"steps"`
}

type flowDefinitionPurposeJSON struct {
	Purpose     string `json:"purpose"`
	InitialStep string `json:"initial_step"`
}

type flowDefinitionAudienceJSON struct {
	AppID            *string `json:"app_id,omitempty"`
	TeamID           *string `json:"team_id,omitempty"`
	SchemaID         *string `json:"schema_id,omitempty"`
	IsProjectDefault bool    `json:"is_project_default"`
}

type flowDefinitionStepJSON struct {
	Name        string                   `json:"name"`
	Type        string                   `json:"type"`
	Config      map[string]any           `json:"config,omitempty"`
	Transitions []flowStepTransitionJSON `json:"transitions"`
}

type flowStepTransitionJSON struct {
	Action *string `json:"action"`
	Target string  `json:"target,omitempty"`
}

// FlowDefinitionRepository implements [domain.FlowDefinitionRepository]
// using a single table where all nested data lives in a JSONB column.
// It is optimised for the read-heavy, rarely-written access pattern of flow
// definitions: each read is a single PK lookup with no joins or assembly.
//
// Use [NewPostgresFlowDefinitionRepository] or [NewSpannerFlowDefinitionRepository]
// to construct an instance with the correct dialect.
type FlowDefinitionRepository struct {
	Client          database.QueryExecutor
	statusCast      string // SQL cast suffix for a status value, e.g. "::zitadel_nextgen.flow_definition_states"
	purposeElemCast string // SQL cast suffix for a single purpose value, e.g. "::zitadel_nextgen.flow_definition_purposes"
	purposeArrCast  string // SQL cast suffix for a purposes array, e.g. "::zitadel_nextgen.flow_definition_purposes[]"
}

// NewPostgresFlowDefinitionRepository returns a repository configured for the
// Postgres dialect, which uses ENUM types that require explicit SQL casts.
func NewPostgresFlowDefinitionRepository(client database.QueryExecutor) *FlowDefinitionRepository {
	return &FlowDefinitionRepository{
		Client:          client,
		statusCast:      "::zitadel_nextgen.flow_definition_states",
		purposeElemCast: "::zitadel_nextgen.flow_definition_purposes",
		purposeArrCast:  "::zitadel_nextgen.flow_definition_purposes[]",
	}
}

// NewSpannerFlowDefinitionRepository returns a repository configured for the
// Spanner PostgreSQL dialect, which uses plain TEXT columns with no casts.
func NewSpannerFlowDefinitionRepository(client database.QueryExecutor) *FlowDefinitionRepository {
	return &FlowDefinitionRepository{Client: client}
}

var _ domain.FlowDefinitionRepository = (*FlowDefinitionRepository)(nil)

func (r *FlowDefinitionRepository) CreateFlowDefinition(ctx context.Context, def *domain.FlowDefinition) error {
	content, err := marshalFlowDefinitionContent(def)
	if err != nil {
		return err
	}

	purposes := make(StringArray, len(def.Purposes))
	for i, p := range def.Purposes {
		purposes[i] = p.Purpose.String()
	}

	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(tableFlowDefinitions)
	b.WriteString(" (project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at) VALUES (")
	b.WriteArgs(def.ProjectID, def.ID, def.Name, def.SchemaVersion, def.Status.String()+r.statusCast, purposes.String()+r.purposeArrCast, content, database.NowInstruction, database.NowInstruction)
	b.WriteString(")")

	_, err = r.Client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *FlowDefinitionRepository) GetFlowDefinition(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error) {
	b := database.NewStatementBuilder(
		"SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at FROM ")
	b.WriteString(tableFlowDefinitions)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND id = ")
	b.WriteArg(id)

	row, err := getOne[flowDefinitionRow](ctx, r.Client, b)
	if err != nil {
		return nil, err
	}
	return rowToFlowDefinition(*row)
}

func (r *FlowDefinitionRepository) ListFlowDefinitions(ctx context.Context, projectID string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
	o := domain.ApplyFlowDefinitionListOptions(opts)

	b := database.NewStatementBuilder(
		"SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at FROM ")
	b.WriteString(tableFlowDefinitions)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)

	if o.Status != nil {
		b.WriteString(" AND status = ")
		b.WriteString(b.AppendArg(o.Status.String()) + r.statusCast)
	}
	if o.Purpose != nil {
		b.WriteString(" AND ")
		b.WriteString(b.AppendArg(o.Purpose.String()) + r.purposeElemCast)
		b.WriteString(" = ANY(purposes)")
	}

	if o.SchemaVersion != nil {
		b.WriteString(" AND schema_version = ")
		b.WriteString(b.AppendArg(o.SchemaVersion))
	}

	b.WriteString(" ORDER BY created_at ASC")

	if o.Limit > 0 {
		b.WriteString(" LIMIT ")
		b.WriteArg(o.Limit)
	}
	if o.Offset > 0 {
		b.WriteString(" OFFSET ")
		b.WriteArg(o.Offset)
	}
	rows, err := getMany[flowDefinitionRow](ctx, r.Client, b)
	if err != nil {
		return nil, err
	}
	return rowsToFlowDefinitions(rows)
}

func (r *FlowDefinitionRepository) UpdateFlowDefinitionStatus(ctx context.Context, projectID, id string, status domain.FlowDefinitionStatus) error {
	condition := database.And(
		database.NewTextCondition(colFlowDefProjectID, database.TextOperationEqual, projectID),
		database.NewTextCondition(colFlowDefID, database.TextOperationEqual, id),
	)
	_, err := updateOne(ctx, r.Client, flowDefinition{}, condition,
		database.NewChange(colFlowDefStatus, status.String()),
		database.NewChange(colFlowDefUpdatedAt, database.NowInstruction),
	)
	return err
}

func (r *FlowDefinitionRepository) DeleteFlowDefinition(ctx context.Context, projectID, id string) error {
	condition := database.And(
		database.NewTextCondition(colFlowDefProjectID, database.TextOperationEqual, projectID),
		database.NewTextCondition(colFlowDefID, database.TextOperationEqual, id),
	)
	_, err := deleteOne(ctx, r.Client, flowDefinition{}, condition)
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
		AppID:            def.Audience.AppID,
		TeamID:           def.Audience.TeamID,
		SchemaID:         def.Audience.SchemaID,
		IsProjectDefault: def.Audience.IsProjectDefault,
	}

	steps := make([]flowDefinitionStepJSON, len(def.Steps))
	for i, s := range def.Steps {
		transitions := make([]flowStepTransitionJSON, len(s.Transitions))
		for j, t := range s.Transitions {
			tr := flowStepTransitionJSON{Target: t.Target}
			if t.Action != nil {
				tr.Action = new(t.Action.String())
			}
			transitions[j] = tr
		}
		steps[i] = flowDefinitionStepJSON{
			Name:        s.Name,
			Type:        s.Type.String(),
			Config:      s.Config,
			Transitions: transitions,
		}
	}

	return json.Marshal(flowDefinitionContent{
		Purposes: purposes,
		Audience: audience,
		Steps:    steps,
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
		stepType, err := domain.FlowStepTypeString(s.Type)
		if err != nil {
			return nil, err
		}
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
		steps[i] = domain.FlowDefinitionStep{
			Name:        s.Name,
			Type:        stepType,
			Config:      s.Config,
			Transitions: transitions,
		}
	}

	return &domain.FlowDefinition{
		ProjectID:     row.ProjectID,
		ID:            row.ID,
		Name:          row.Name,
		SchemaVersion: row.SchemaVersion,
		Status:        row.Status,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
		Purposes:      purposes,
		Audience: domain.FlowDefinitionAudience{
			AppID:            content.Audience.AppID,
			TeamID:           content.Audience.TeamID,
			SchemaID:         content.Audience.SchemaID,
			IsProjectDefault: content.Audience.IsProjectDefault,
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
