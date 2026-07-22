// Package flowdefinition holds shared encoding helpers for the flow_definitions
// definition JSON column used by v2 dialect statements.
package flowdefinition

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Content is the structure stored inside the definition JSON/JSONB column.
type Content struct {
	UserSchema string            `json:"user_schema"`
	Purposes   map[string]string `json:"purposes"`
	Audience   AudienceJSON      `json:"audience"`
	Steps      []StepJSON        `json:"steps"`
}

type AudienceJSON struct {
	AppIDs  []string `json:"app_ids,omitempty"`
	TeamIDs []string `json:"team_ids,omitempty"`
}

type StepJSON struct {
	Name         string                    `json:"name"`
	Fields       []string                  `json:"fields,omitempty"`
	Actions      []ActionJSON              `json:"actions,omitempty"`
	Gates        map[string]GateJSON       `json:"gates,omitempty"`
	SSOProviders []SSOProviderJSON         `json:"sso_providers,omitempty"`
	OnSuccess    *string                   `json:"on_success,omitempty"`
	Complete     *string                   `json:"complete,omitempty"`
	Transitions  map[string]TransitionJSON `json:"transitions,omitempty"`
}

type ActionJSON struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	TextKey string `json:"text_key,omitempty"`
	Primary bool   `json:"primary,omitempty"`
}

type GateJSON struct {
	Kind     string         `json:"kind"`
	Provider string         `json:"provider,omitempty"`
	Config   map[string]any `json:"config,omitempty"`
}

type SSOProviderJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Template string `json:"template"`
}

type TransitionJSON struct {
	Action *string `json:"action,omitempty"`
	Target string  `json:"target"`
}

// Marshal converts the domain aggregate's nested fields into JSON for the
// definition column.
func Marshal(def *domain.FlowDefinition) ([]byte, error) {
	purposes := make(map[string]string, len(def.Purposes))
	for p, initialStep := range def.Purposes {
		purposes[p.String()] = initialStep
	}

	steps := make([]StepJSON, len(def.Steps))
	for i, s := range def.Steps {
		steps[i] = marshalStep(s)
	}

	return json.Marshal(Content{
		UserSchema: def.UserSchema,
		Purposes:   purposes,
		Audience: AudienceJSON{
			AppIDs:  def.Audience.AppIDs,
			TeamIDs: def.Audience.TeamIDs,
		},
		Steps: steps,
	})
}

func marshalStep(s domain.FlowDefinitionStep) StepJSON {
	out := StepJSON{
		Name:   s.Name,
		Fields: domain.FieldsToStrings(s.Fields),
	}
	if len(s.Transitions) > 0 {
		out.Transitions = make(map[string]TransitionJSON, len(s.Transitions))
		for name, t := range s.Transitions {
			tr := TransitionJSON{Target: t.Target}
			if t.Action != nil {
				action := t.Action.String()
				tr.Action = &action
			}
			out.Transitions[name] = tr
		}
	}
	if len(s.Actions) > 0 {
		out.Actions = make([]ActionJSON, 0, len(s.Actions))
		for _, a := range s.Actions {
			out.Actions = append(out.Actions, ActionJSON{
				Name:    a.Name,
				Kind:    a.Kind.String(),
				TextKey: a.TextKey,
				Primary: a.Primary,
			})
		}
	}
	if len(s.Gates) > 0 {
		out.Gates = make(map[string]GateJSON, len(s.Gates))
		for name, g := range s.Gates {
			out.Gates[name] = GateJSON{
				Kind:     g.Kind.String(),
				Provider: g.Provider,
				Config:   g.Config,
			}
		}
	}
	if len(s.SSOProviders) > 0 {
		out.SSOProviders = make([]SSOProviderJSON, len(s.SSOProviders))
		for j, p := range s.SSOProviders {
			out.SSOProviders[j] = SSOProviderJSON{
				ID:       p.ID,
				Name:     p.Name,
				Template: p.Template,
			}
		}
	}
	if s.OnSuccess != nil {
		onSuccess := s.OnSuccess.String()
		out.OnSuccess = &onSuccess
	}
	if s.Complete != nil {
		complete := s.Complete.String()
		out.Complete = &complete
	}
	return out
}

// PurposeStrings returns the denormalized purposes array column values.
func PurposeStrings(def *domain.FlowDefinition) []string {
	purposeStrs := make([]string, 0, len(def.Purposes))
	for p := range def.Purposes {
		purposeStrs = append(purposeStrs, p.String())
	}
	return purposeStrs
}

// ToDomain converts scanned row columns plus definition JSON into the domain aggregate.
func ToDomain(
	projectID, id, name, schemaVersion string,
	status domain.FlowDefinitionStatus,
	createdAt, updatedAt time.Time,
	rawDefinition []byte,
) (*domain.FlowDefinition, error) {
	var content Content
	if len(rawDefinition) > 0 {
		if err := json.Unmarshal(rawDefinition, &content); err != nil {
			return nil, err
		}
	}
	return contentToDomain(projectID, id, name, schemaVersion, status, createdAt, updatedAt, content)
}

func contentToDomain(
	projectID, id, name, schemaVersion string,
	status domain.FlowDefinitionStatus,
	createdAt, updatedAt time.Time,
	content Content,
) (*domain.FlowDefinition, error) {
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
		step, err := unmarshalStep(s)
		if err != nil {
			return nil, err
		}
		steps[i] = step
	}

	return &domain.FlowDefinition{
		ProjectID:     projectID,
		ID:            id,
		Name:          name,
		SchemaVersion: schemaVersion,
		Status:        status,
		// Spanner returns UTC while pgx defaults to local; normalize to UTC.
		CreatedAt:  createdAt.UTC(),
		UpdatedAt:  updatedAt.UTC(),
		UserSchema: content.UserSchema,
		Purposes:   purposes,
		Audience: domain.FlowDefinitionAudience{
			AppIDs:  content.Audience.AppIDs,
			TeamIDs: content.Audience.TeamIDs,
		},
		Steps: steps,
	}, nil
}

func unmarshalStep(s StepJSON) (domain.FlowDefinitionStep, error) {
	step := domain.FlowDefinitionStep{
		Name:   s.Name,
		Fields: domain.FieldsFromStrings(s.Fields),
	}
	if len(s.Transitions) > 0 {
		step.Transitions = make(map[string]domain.FlowStepTransition, len(s.Transitions))
		for name, t := range s.Transitions {
			tr := domain.FlowStepTransition{Target: t.Target}
			if t.Action != nil {
				action, err := domain.FlowDefinitionTransitionActionString(*t.Action)
				if err != nil {
					return step, err
				}
				tr.Action = &action
			}
			step.Transitions[name] = tr
		}
	}
	if len(s.Actions) > 0 {
		step.Actions = make([]domain.FlowStepAction, 0, len(s.Actions))
		for _, a := range s.Actions {
			kind, err := domain.FlowActionKindString(a.Kind)
			if err != nil {
				return step, fmt.Errorf("step %q: action %q has invalid kind %q: %w", s.Name, a.Name, a.Kind, err)
			}
			step.Actions = append(step.Actions, domain.FlowStepAction{
				Name:    a.Name,
				Kind:    kind,
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
				return step, err
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
			return step, err
		}
		step.OnSuccess = &onSuccess
	}
	if s.Complete != nil {
		complete, err := domain.FlowStepCompleteString(*s.Complete)
		if err != nil {
			return step, err
		}
		step.Complete = &complete
	}
	return step, nil
}
