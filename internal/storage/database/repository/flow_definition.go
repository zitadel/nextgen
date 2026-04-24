package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	tableFlowDefinitions           = "zitadel_nextgen.flow_definitions"
	tableFlowDefinitionPurposes    = "zitadel_nextgen.flow_definition_purposes"
	tableFlowDefinitionAudiences   = "zitadel_nextgen.flow_definition_audiences"
	tableFlowDefinitionSteps       = "zitadel_nextgen.flow_definition_steps"
	tableFlowDefinitionTransitions = "zitadel_nextgen.flow_definition_step_transitions"
)

// Column declarations for flow_definitions.
var (
	colFlowDefInstanceID    = database.NewColumn(tableFlowDefinitions, "instance_id")
	colFlowDefID            = database.NewColumn(tableFlowDefinitions, "id")
	colFlowDefName          = database.NewColumn(tableFlowDefinitions, "name")
	colFlowDefEngineVersion = database.NewColumn(tableFlowDefinitions, "engine_version")
	colFlowDefSchemaVersion = database.NewColumn(tableFlowDefinitions, "schema_version")
	colFlowDefStatus        = database.NewColumn(tableFlowDefinitions, "status")
	colFlowDefCreatedAt     = database.NewColumn(tableFlowDefinitions, "created_at")
	colFlowDefUpdatedAt     = database.NewColumn(tableFlowDefinitions, "updated_at")
)

// flowDefinitions implements the repository-internal interfaces required by
// the shared updateOne / deleteOne helpers.
type flowDefinitions struct{}

func (flowDefinitions) PrimaryKeyColumns() []database.Column {
	return []database.Column{colFlowDefInstanceID, colFlowDefID}
}

func (flowDefinitions) UpdatedAtColumn() database.Column { return colFlowDefUpdatedAt }

func (flowDefinitions) qualifiedTableName() string { return tableFlowDefinitions }

// Scan targets — fields map to DB columns via scany `db` tags.

type flowDefinitionRow struct {
	InstanceID    string    `db:"instance_id"`
	ID            string    `db:"id"`
	Name          string    `db:"name"`
	EngineVersion string    `db:"engine_version"`
	SchemaVersion string    `db:"schema_version"`
	Status        string    `db:"status"`
	CreatedAt     time.Time `db:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"`
}

type flowDefinitionPurposeRow struct {
	Purpose     string `db:"purpose"`
	InitialStep string `db:"initial_step"`
}

type flowDefinitionAudienceRow struct {
	AppID             *string `db:"app_id"`
	OrgID             *string `db:"org_id"`
	SchemaID          *string `db:"schema_id"`
	IsInstanceDefault bool    `db:"is_instance_default"`
}

type flowDefinitionStepRow struct {
	Name   string                 `db:"name"`
	Type   string                 `db:"type"`
	Config JSON[map[string]any]   `db:"config"`
}

type flowDefinitionTransitionRow struct {
	StepName     string  `db:"step_name"`
	Action       string  `db:"action"`
	TargetStep   *string `db:"target_step"`
	PivotPurpose *string `db:"pivot_purpose"`
}

// FlowDefinitionRepository implements [domain.FlowDefinitionRepository] using
// the shared database abstraction layer.
type FlowDefinitionRepository struct {
	Client database.QueryExecutor
}

var _ domain.FlowDefinitionRepository = (*FlowDefinitionRepository)(nil)

// CreateFlowDefinition persists the full aggregate transactionally.
func (r *FlowDefinitionRepository) CreateFlowDefinition(ctx context.Context, def *domain.FlowDefinition) error {
	beginner, ok := r.Client.(database.Beginner)
	if !ok {
		return r.insertFlowDefinition(ctx, r.Client, def)
	}
	tx, err := beginner.Begin(ctx, nil)
	if err != nil {
		return err
	}
	return tx.End(ctx, r.insertFlowDefinition(ctx, tx, def))
}

func (r *FlowDefinitionRepository) insertFlowDefinition(ctx context.Context, ex database.QueryExecutor, def *domain.FlowDefinition) error {
	if err := r.insertMain(ctx, ex, def); err != nil {
		return err
	}
	for _, p := range def.Purposes {
		if err := r.insertPurpose(ctx, ex, def.InstanceID, def.ID, p); err != nil {
			return err
		}
	}
	if err := r.insertAudience(ctx, ex, def.InstanceID, def.ID, def.Audience); err != nil {
		return err
	}
	for _, s := range def.Steps {
		if err := r.insertStep(ctx, ex, def.InstanceID, def.ID, s); err != nil {
			return err
		}
		for _, t := range s.Transitions {
			if err := r.insertTransition(ctx, ex, def.InstanceID, def.ID, s.Name, t); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *FlowDefinitionRepository) insertMain(ctx context.Context, ex database.QueryExecutor, def *domain.FlowDefinition) error {
	b := database.NewStatementBuilder(
		"INSERT INTO " + tableFlowDefinitions +
			" (instance_id, id, name, engine_version, schema_version, status, created_at, updated_at)" +
			" VALUES (")
	b.WriteArgs(def.InstanceID, def.ID, def.Name, def.EngineVersion, def.SchemaVersion, string(def.Status))
	b.WriteString(", ")
	b.WriteArg(database.NowInstruction)
	b.WriteString(", ")
	b.WriteArg(database.NowInstruction)
	b.WriteString(")")
	_, err := ex.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *FlowDefinitionRepository) insertPurpose(
	ctx context.Context,
	ex database.QueryExecutor,
	instanceID, definitionID string,
	p domain.FlowDefinitionPurposeEntry,
) error {
	b := database.NewStatementBuilder(
		"INSERT INTO " + tableFlowDefinitionPurposes +
			" (instance_id, definition_id, purpose, initial_step)" +
			" VALUES (")
	b.WriteArgs(instanceID, definitionID, string(p.Purpose), p.InitialStep)
	b.WriteString(")")
	_, err := ex.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *FlowDefinitionRepository) insertAudience(
	ctx context.Context,
	ex database.QueryExecutor,
	instanceID, definitionID string,
	a domain.FlowDefinitionAudience,
) error {
	b := database.NewStatementBuilder(
		"INSERT INTO " + tableFlowDefinitionAudiences +
			" (instance_id, definition_id, app_id, org_id, schema_id, is_instance_default)" +
			" VALUES (")
	b.WriteArgs(instanceID, definitionID, a.AppID, a.OrgID, a.SchemaID, a.IsInstanceDefault)
	b.WriteString(")")
	_, err := ex.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *FlowDefinitionRepository) insertStep(
	ctx context.Context,
	ex database.QueryExecutor,
	instanceID, definitionID string,
	s domain.FlowDefinitionStep,
) error {
	var configBytes []byte
	if len(s.Config) > 0 {
		var err error
		configBytes, err = json.Marshal(s.Config)
		if err != nil {
			return err
		}
	}
	b := database.NewStatementBuilder(
		"INSERT INTO " + tableFlowDefinitionSteps +
			" (instance_id, definition_id, name, type, config)" +
			" VALUES (")
	b.WriteArgs(instanceID, definitionID, s.Name, string(s.Type), configBytes)
	b.WriteString(")")
	_, err := ex.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *FlowDefinitionRepository) insertTransition(
	ctx context.Context,
	ex database.QueryExecutor,
	instanceID, definitionID, stepName string,
	t domain.FlowStepTransition,
) error {
	var pivotPurpose *string
	if t.PivotPurpose != nil {
		s := string(*t.PivotPurpose)
		pivotPurpose = &s
	}
	b := database.NewStatementBuilder(
		"INSERT INTO " + tableFlowDefinitionTransitions +
			" (instance_id, definition_id, step_name, action, target_step, pivot_purpose)" +
			" VALUES (")
	b.WriteArgs(instanceID, definitionID, stepName, t.Action, t.TargetStep, pivotPurpose)
	b.WriteString(")")
	_, err := ex.Exec(ctx, b.String(), b.Args()...)
	return err
}

// GetFlowDefinition loads the full aggregate by querying all five tables.
func (r *FlowDefinitionRepository) GetFlowDefinition(ctx context.Context, instanceID, id string) (*domain.FlowDefinition, error) {
	row, err := r.queryMain(ctx, instanceID, id)
	if err != nil {
		return nil, err
	}

	purposes, err := r.queryPurposes(ctx, instanceID, id)
	if err != nil {
		return nil, err
	}

	audience, err := r.queryAudience(ctx, instanceID, id)
	if err != nil {
		return nil, err
	}

	steps, err := r.querySteps(ctx, instanceID, id)
	if err != nil {
		return nil, err
	}

	transitions, err := r.queryTransitions(ctx, instanceID, id)
	if err != nil {
		return nil, err
	}

	return assembleFlowDefinition(row, purposes, audience, steps, transitions), nil
}

func (r *FlowDefinitionRepository) queryMain(ctx context.Context, instanceID, id string) (*flowDefinitionRow, error) {
	b := database.NewStatementBuilder(
		"SELECT instance_id, id, name, engine_version, schema_version, status, created_at, updated_at" +
			" FROM " + tableFlowDefinitions +
			" WHERE instance_id = ")
	b.WriteArg(instanceID)
	b.WriteString(" AND id = ")
	b.WriteArg(id)
	return getOne[flowDefinitionRow](ctx, r.Client, b)
}

func (r *FlowDefinitionRepository) queryPurposes(ctx context.Context, instanceID, id string) ([]*flowDefinitionPurposeRow, error) {
	b := database.NewStatementBuilder(
		"SELECT purpose, initial_step" +
			" FROM " + tableFlowDefinitionPurposes +
			" WHERE instance_id = ")
	b.WriteArg(instanceID)
	b.WriteString(" AND definition_id = ")
	b.WriteArg(id)
	return getMany[flowDefinitionPurposeRow](ctx, r.Client, b)
}

func (r *FlowDefinitionRepository) queryAudience(ctx context.Context, instanceID, id string) (*flowDefinitionAudienceRow, error) {
	b := database.NewStatementBuilder(
		"SELECT app_id, org_id, schema_id, is_instance_default" +
			" FROM " + tableFlowDefinitionAudiences +
			" WHERE instance_id = ")
	b.WriteArg(instanceID)
	b.WriteString(" AND definition_id = ")
	b.WriteArg(id)
	return getOne[flowDefinitionAudienceRow](ctx, r.Client, b)
}

func (r *FlowDefinitionRepository) querySteps(ctx context.Context, instanceID, id string) ([]*flowDefinitionStepRow, error) {
	b := database.NewStatementBuilder(
		"SELECT name, type, config" +
			" FROM " + tableFlowDefinitionSteps +
			" WHERE instance_id = ")
	b.WriteArg(instanceID)
	b.WriteString(" AND definition_id = ")
	b.WriteArg(id)
	return getMany[flowDefinitionStepRow](ctx, r.Client, b)
}

func (r *FlowDefinitionRepository) queryTransitions(ctx context.Context, instanceID, id string) ([]*flowDefinitionTransitionRow, error) {
	b := database.NewStatementBuilder(
		"SELECT step_name, action, target_step, pivot_purpose" +
			" FROM " + tableFlowDefinitionTransitions +
			" WHERE instance_id = ")
	b.WriteArg(instanceID)
	b.WriteString(" AND definition_id = ")
	b.WriteArg(id)
	return getMany[flowDefinitionTransitionRow](ctx, r.Client, b)
}

// ListFlowDefinitions returns top-level metadata only (child records are not populated).
func (r *FlowDefinitionRepository) ListFlowDefinitions(ctx context.Context, instanceID string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
	o := domain.ApplyFlowDefinitionListOptions(opts)

	b := database.NewStatementBuilder(
		"SELECT instance_id, id, name, engine_version, schema_version, status, created_at, updated_at" +
			" FROM " + tableFlowDefinitions +
			" WHERE instance_id = ")
	b.WriteArg(instanceID)

	if o.Status != nil {
		b.WriteString(" AND status = ")
		b.WriteArg(string(*o.Status))
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

	defs := make([]*domain.FlowDefinition, len(rows))
	for i, row := range rows {
		defs[i] = rowToFlowDefinition(row)
	}
	return defs, nil
}

// UpdateFlowDefinitionStatus transitions a definition's status.
func (r *FlowDefinitionRepository) UpdateFlowDefinitionStatus(ctx context.Context, instanceID, id string, status domain.FlowDefinitionStatus) error {
	condition := database.And(
		database.NewTextCondition(colFlowDefInstanceID, database.TextOperationEqual, instanceID),
		database.NewTextCondition(colFlowDefID, database.TextOperationEqual, id),
	)
	_, err := updateOne[flowDefinitions](ctx, r.Client, flowDefinitions{}, condition,
		database.NewChange(colFlowDefStatus, string(status)),
		database.NewChange(colFlowDefUpdatedAt, database.NowInstruction),
	)
	return err
}

// DeleteFlowDefinition removes the definition; child rows are removed by CASCADE.
func (r *FlowDefinitionRepository) DeleteFlowDefinition(ctx context.Context, instanceID, id string) error {
	condition := database.And(
		database.NewTextCondition(colFlowDefInstanceID, database.TextOperationEqual, instanceID),
		database.NewTextCondition(colFlowDefID, database.TextOperationEqual, id),
	)
	_, err := deleteOne[flowDefinitions](ctx, r.Client, flowDefinitions{}, condition)
	return err
}

// assembleFlowDefinition builds a domain aggregate from raw scan results.
func assembleFlowDefinition(
	row *flowDefinitionRow,
	purposes []*flowDefinitionPurposeRow,
	audience *flowDefinitionAudienceRow,
	steps []*flowDefinitionStepRow,
	transitions []*flowDefinitionTransitionRow,
) *domain.FlowDefinition {
	def := rowToFlowDefinition(row)

	def.Purposes = make([]domain.FlowDefinitionPurposeEntry, len(purposes))
	for i, p := range purposes {
		def.Purposes[i] = domain.FlowDefinitionPurposeEntry{
			Purpose:     domain.FlowDefinitionPurpose(p.Purpose),
			InitialStep: p.InitialStep,
		}
	}

	if audience != nil {
		def.Audience = domain.FlowDefinitionAudience{
			AppID:             audience.AppID,
			OrgID:             audience.OrgID,
			SchemaID:          audience.SchemaID,
			IsInstanceDefault: audience.IsInstanceDefault,
		}
	}

	// Index transitions by step name for O(n) assembly.
	byStep := make(map[string][]domain.FlowStepTransition, len(transitions))
	for _, t := range transitions {
		tr := domain.FlowStepTransition{
			Action:     t.Action,
			TargetStep: t.TargetStep,
		}
		if t.PivotPurpose != nil {
			p := domain.FlowDefinitionPurpose(*t.PivotPurpose)
			tr.PivotPurpose = &p
		}
		byStep[t.StepName] = append(byStep[t.StepName], tr)
	}

	def.Steps = make([]domain.FlowDefinitionStep, len(steps))
	for i, s := range steps {
		def.Steps[i] = domain.FlowDefinitionStep{
			Name:        s.Name,
			Type:        domain.FlowStepType(s.Type),
			Config:      s.Config.Value,
			Transitions: byStep[s.Name],
		}
	}

	return def
}

func rowToFlowDefinition(row *flowDefinitionRow) *domain.FlowDefinition {
	return &domain.FlowDefinition{
		InstanceID:    row.InstanceID,
		ID:            row.ID,
		Name:          row.Name,
		EngineVersion: row.EngineVersion,
		SchemaVersion: row.SchemaVersion,
		Status:        domain.FlowDefinitionStatus(row.Status),
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}
