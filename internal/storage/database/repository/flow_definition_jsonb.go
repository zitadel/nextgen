package repository

import (
	"context"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const tableFlowDefinitionsJSONB = "zitadel_nextgen.flow_definitions_jsonb"

var (
	colFlowDefJSONBInstanceID = database.NewColumn(tableFlowDefinitionsJSONB, "instance_id")
	colFlowDefJSONBID         = database.NewColumn(tableFlowDefinitionsJSONB, "id")
	colFlowDefJSONBStatus     = database.NewColumn(tableFlowDefinitionsJSONB, "status")
	colFlowDefJSONBUpdatedAt  = database.NewColumn(tableFlowDefinitionsJSONB, "updated_at")
)

type flowDefinitions struct{}

func (flowDefinitions) PrimaryKeyColumns() []database.Column {
	return []database.Column{colFlowDefJSONBInstanceID, colFlowDefJSONBID}
}

func (flowDefinitions) UpdatedAtColumn() database.Column { return colFlowDefJSONBUpdatedAt }

func (flowDefinitions) qualifiedTableName() string { return tableFlowDefinitionsJSONB }

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
	AppID             *string `json:"app_id,omitempty"`
	OrgID             *string `json:"org_id,omitempty"`
	SchemaID          *string `json:"schema_id,omitempty"`
	IsInstanceDefault bool    `json:"is_instance_default"`
}

type flowDefinitionStepJSON struct {
	Name        string                   `json:"name"`
	Type        string                   `json:"type"`
	Config      map[string]any           `json:"config,omitempty"`
	Transitions []flowStepTransitionJSON `json:"transitions"`
}

type flowStepTransitionJSON struct {
	Action       string  `json:"action"`
	TargetStep   *string `json:"target_step,omitempty"`
	PivotPurpose *string `json:"pivot_purpose,omitempty"`
}

// FlowDefinitionJSONBRepository implements [domain.FlowDefinitionRepository]
// using a single table where all nested data lives in a JSONB column.
// It is optimised for the read-heavy, rarely-written access pattern of flow
// definitions: each read is a single PK lookup with no joins or assembly.
type FlowDefinitionJSONBRepository struct {
	Client database.QueryExecutor
}

var _ domain.FlowDefinitionRepository = (*FlowDefinitionJSONBRepository)(nil)

func (r *FlowDefinitionJSONBRepository) CreateFlowDefinition(ctx context.Context, def *domain.FlowDefinition) error {
	content, err := marshalFlowDefinitionContent(def)
	if err != nil {
		return err
	}

	b := database.NewStatementBuilder(
		"INSERT INTO " + tableFlowDefinitionsJSONB +
			" (instance_id, id, name, engine_version, schema_version, status, definition, created_at, updated_at)" +
			" VALUES (")
	b.WriteArgs(def.InstanceID, def.ID, def.Name, def.EngineVersion, def.SchemaVersion, string(def.Status), content)
	b.WriteString(", ")
	b.WriteArg(database.NowInstruction)
	b.WriteString(", ")
	b.WriteArg(database.NowInstruction)
	b.WriteString(")")

	_, err = r.Client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *FlowDefinitionJSONBRepository) GetFlowDefinition(ctx context.Context, instanceID, id string) (*domain.FlowDefinition, error) {
	b := database.NewStatementBuilder(
		"SELECT instance_id, id, name, engine_version, schema_version, status, definition, created_at, updated_at" +
			" FROM " + tableFlowDefinitionsJSONB +
			" WHERE instance_id = ")
	b.WriteArg(instanceID)
	b.WriteString(" AND id = ")
	b.WriteArg(id)

	return getOne[domain.FlowDefinition](ctx, r.Client, b)
}

func (r *FlowDefinitionJSONBRepository) ListFlowDefinitions(ctx context.Context, instanceID string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
	o := domain.ApplyFlowDefinitionListOptions(opts)

	b := database.NewStatementBuilder(
		"SELECT instance_id, id, name, engine_version, schema_version, status, purpose, definition, created_at, updated_at" +
			" FROM " + tableFlowDefinitionsJSONB +
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

	return getMany[domain.FlowDefinition](ctx, r.Client, b)
}

func (r *FlowDefinitionJSONBRepository) UpdateFlowDefinitionStatus(ctx context.Context, instanceID, id string, status domain.FlowDefinitionStatus) error {
	condition := database.And(
		database.NewTextCondition(colFlowDefJSONBInstanceID, database.TextOperationEqual, instanceID),
		database.NewTextCondition(colFlowDefJSONBID, database.TextOperationEqual, id),
	)
	_, err := updateOne(ctx, r.Client, flowDefinitions{}, condition,
		database.NewChange(colFlowDefJSONBStatus, string(status)),
		database.NewChange(colFlowDefJSONBUpdatedAt, database.NowInstruction),
	)
	return err
}

func (r *FlowDefinitionJSONBRepository) DeleteFlowDefinition(ctx context.Context, instanceID, id string) error {
	condition := database.And(
		database.NewTextCondition(colFlowDefJSONBInstanceID, database.TextOperationEqual, instanceID),
		database.NewTextCondition(colFlowDefJSONBID, database.TextOperationEqual, id),
	)
	_, err := deleteOne(ctx, r.Client, flowDefinitions{}, condition)
	return err
}

// marshalFlowDefinitionContent converts the domain aggregate's nested fields
// into a JSON byte slice ready for the definition column.
func marshalFlowDefinitionContent(def *domain.FlowDefinition) ([]byte, error) {
	purposes := make([]flowDefinitionPurposeJSON, len(def.Purposes))
	for i, p := range def.Purposes {
		purposes[i] = flowDefinitionPurposeJSON{
			Purpose:     string(p.Purpose),
			InitialStep: p.InitialStep,
		}
	}

	audience := flowDefinitionAudienceJSON{
		AppID:             def.Audience.AppID,
		OrgID:             def.Audience.OrgID,
		SchemaID:          def.Audience.SchemaID,
		IsInstanceDefault: def.Audience.IsInstanceDefault,
	}

	steps := make([]flowDefinitionStepJSON, len(def.Steps))
	for i, s := range def.Steps {
		transitions := make([]flowStepTransitionJSON, len(s.Transitions))
		for j, t := range s.Transitions {
			tr := flowStepTransitionJSON{Action: t.Action, TargetStep: t.TargetStep}
			if t.PivotPurpose != nil {
				p := string(*t.PivotPurpose)
				tr.PivotPurpose = &p
			}
			transitions[j] = tr
		}
		steps[i] = flowDefinitionStepJSON{
			Name:        s.Name,
			Type:        string(s.Type),
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
