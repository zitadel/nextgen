package flowdefinition

import (
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
)

const selectFlowDefinitionsSQL = `SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at
FROM zitadel_nextgen.flow_definitions`

// Row is a scanned flow_definitions table row.
type Row struct {
	ProjectID     string
	ID            string
	Name          string
	SchemaVersion string
	Status        domain.FlowDefinitionStatus
	Definition    JSON[Content]
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Content is the JSON payload stored in the definition column.
type Content struct {
	UserSchema string         `json:"user_schema"`
	Purposes   map[string]string `json:"purposes"`
	Audience   AudienceJSON   `json:"audience"`
	Steps      []StepJSON     `json:"steps"`
}

type AudienceJSON struct {
	AppIDs  []string `json:"app_ids,omitempty"`
	TeamIDs []string `json:"team_ids,omitempty"`
}

type StepJSON struct {
	Name         string                       `json:"name"`
	Fields       []string                     `json:"fields,omitempty"`
	Actions      []StepActionJSON             `json:"actions,omitempty"`
	Gates        map[string]StepGateJSON      `json:"gates,omitempty"`
	SSOProviders []SSOProviderJSON            `json:"sso_providers,omitempty"`
	OnSuccess    *string                      `json:"on_success,omitempty"`
	Complete     *string                      `json:"complete,omitempty"`
	Transitions  map[string]StepTransitionJSON `json:"transitions,omitempty"`
}

type StepActionJSON struct {
	Name    string `json:"name"`
	TextKey string `json:"text_key,omitempty"`
	Primary bool   `json:"primary,omitempty"`
}

type StepGateJSON struct {
	Kind     string         `json:"kind"`
	Provider string         `json:"provider,omitempty"`
	Config   map[string]any `json:"config,omitempty"`
}

type SSOProviderJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Template string `json:"template"`
}

type StepTransitionJSON struct {
	Action *string `json:"action,omitempty"`
	Target string  `json:"target"`
}

func scanSQLRow(scanner interface{ Scan(dest ...any) error }) (Row, error) {
	var r Row
	err := scanner.Scan(
		&r.ProjectID,
		&r.ID,
		&r.Name,
		&r.SchemaVersion,
		&r.Status,
		&r.Definition,
		&r.CreatedAt,
		&r.UpdatedAt,
	)
	return r, err
}

func scanSQLRows(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]*domain.FlowDefinition, error) {
	var items []*domain.FlowDefinition
	for rows.Next() {
		r, err := scanSQLRow(rows)
		if err != nil {
			return nil, err
		}
		def, err := RowToDomain(r)
		if err != nil {
			return nil, err
		}
		items = append(items, def)
	}
	return items, rows.Err()
}

func MarshalContent(def *domain.FlowDefinition) ([]byte, error) {
	purposes := make(map[string]string, len(def.Purposes))
	for p, initialStep := range def.Purposes {
		purposes[p.String()] = initialStep
	}

	audience := AudienceJSON{
		AppIDs:  def.Audience.AppIDs,
		TeamIDs: def.Audience.TeamIDs,
	}

	steps := make([]StepJSON, len(def.Steps))
	for i, s := range def.Steps {
		var transitions map[string]StepTransitionJSON
		if len(s.Transitions) > 0 {
			transitions = make(map[string]StepTransitionJSON, len(s.Transitions))
			for name, t := range s.Transitions {
				tr := StepTransitionJSON{Target: t.Target}
				if t.Action != nil {
					action := t.Action.String()
					tr.Action = &action
				}
				transitions[name] = tr
			}
		}
		stepJSON := StepJSON{
			Name:        s.Name,
			Fields:      s.Fields,
			Transitions: transitions,
		}
		if len(s.Actions) > 0 {
			stepJSON.Actions = make([]StepActionJSON, 0, len(s.Actions))
			for _, a := range s.Actions {
				stepJSON.Actions = append(stepJSON.Actions, StepActionJSON{
					Name:    a.Name,
					TextKey: a.TextKey,
					Primary: a.Primary,
				})
			}
		}
		if len(s.Gates) > 0 {
			stepJSON.Gates = make(map[string]StepGateJSON, len(s.Gates))
			for name, g := range s.Gates {
				stepJSON.Gates[name] = StepGateJSON{
					Kind:     g.Kind.String(),
					Provider: g.Provider,
					Config:   g.Config,
				}
			}
		}
		if len(s.SSOProviders) > 0 {
			stepJSON.SSOProviders = make([]SSOProviderJSON, len(s.SSOProviders))
			for j, p := range s.SSOProviders {
				stepJSON.SSOProviders[j] = SSOProviderJSON{
					ID:       p.ID,
					Name:     p.Name,
					Template: p.Template,
				}
			}
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

	return json.Marshal(Content{
		UserSchema: def.UserSchema,
		Purposes:   purposes,
		Audience:   audience,
		Steps:      steps,
	})
}

// RowToDomain converts a scanned row into the domain aggregate.
func RowToDomain(row Row) (*domain.FlowDefinition, error) {
	content := row.Definition.Value

	var purposes map[domain.FlowDefinitionPurpose]string
	if len(content.Purposes) > 0 {
		purposes = make(map[domain.FlowDefinitionPurpose]string, len(content.Purposes))
		for purposeStr, initialStep := range content.Purposes {
			purpose, err := domain.FlowDefinitionPurposeString(purposeStr)
			if err != nil {
				return nil, err
			}
			purposes[purpose] = initialStep
		}
	}

	steps := make([]domain.FlowDefinitionStep, len(content.Steps))
	for i, s := range content.Steps {
		var transitions map[string]domain.FlowStepTransition
		if len(s.Transitions) > 0 {
			transitions = make(map[string]domain.FlowStepTransition, len(s.Transitions))
			for name, t := range s.Transitions {
				tr := domain.FlowStepTransition{Target: t.Target}
				if t.Action != nil {
					action, err := domain.FlowDefinitionTransitionActionString(*t.Action)
					if err != nil {
						return nil, err
					}
					tr.Action = &action
				}
				transitions[name] = tr
			}
		}
		step := domain.FlowDefinitionStep{
			Name:        s.Name,
			Fields:      s.Fields,
			Transitions: transitions,
		}
		if len(s.Actions) > 0 {
			step.Actions = make([]domain.FlowStepAction, 0, len(s.Actions))
			for _, a := range s.Actions {
				step.Actions = append(step.Actions, domain.FlowStepAction{
					Name:    a.Name,
					TextKey: a.TextKey,
					Primary: a.Primary,
				})
			}
		}
		if len(s.Gates) > 0 {
			step.Gates = make(map[string]domain.FlowStepGate, len(s.Gates))
			for name, g := range s.Gates {
				gateKind, err := domain.FlowGateKindString(g.Kind)
				if err != nil {
					return nil, err
				}
				step.Gates[name] = domain.FlowStepGate{
					Kind:     gateKind,
					Provider: g.Provider,
					Config:   g.Config,
				}
			}
		}
		if len(s.SSOProviders) > 0 {
			step.SSOProviders = make([]domain.FlowSSOProvider, len(s.SSOProviders))
			for j, p := range s.SSOProviders {
				step.SSOProviders[j] = domain.FlowSSOProvider{
					ID:       p.ID,
					Name:     p.Name,
					Template: p.Template,
				}
			}
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
		CreatedAt:     row.CreatedAt.UTC(),
		UpdatedAt:     row.UpdatedAt.UTC(),
		UserSchema:    content.UserSchema,
		Purposes:      purposes,
		Audience: domain.FlowDefinitionAudience{
			AppIDs:  content.Audience.AppIDs,
			TeamIDs: content.Audience.TeamIDs,
		},
		Steps: steps,
	}, nil
}

// NextCursor builds a keyset cursor when another page may exist.
func NextCursor(items []*domain.FlowDefinition, limit uint32) *query.CursorToken {
	if limit == 0 || uint32(len(items)) < limit || len(items) == 0 {
		return nil
	}
	last := items[len(items)-1]
	return query.NewFlowDefinitionCursor(last.CreatedAt, last.ID)
}
