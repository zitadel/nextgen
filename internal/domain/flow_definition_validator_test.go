package domain_test

import (
	"encoding/json"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

var tenantUserSchema = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "metaSchema": "https://nextgen.com/schemas/user-meta-schema.json",
  "$id": "https://tenant.com/schemas/my-user.json",
  "kind": "user-schema",
  "type": "object",
  "required": [
    "email"
  ],
  "x-auth-methods": {
    "password": {
      "enabled": true,
      "position": 0
    }
  },
  "properties": {
    "email": {
      "title": "Email Address",
      "type": "string",
      "format": "email",
      "x-identifier": true,
      "x-unique": "project"
    }
  }
}`)

var tenantUserSchemaNoProps = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "metaSchema": "https://nextgen.com/schemas/user-meta-schema.json",
  "$id": "https://tenant.com/schemas/my-user.json",
  "kind": "user-schema",
  "type": "object",
  "required": [
    "email"
  ],
  "x-auth-methods": {
    "password": {
      "enabled": true,
      "position": 0
    }
  }
}`)

func TestValidateFlowDefinition(t *testing.T) {
	var userSchema jsonschema.Schema
	marshalErr := json.Unmarshal(tenantUserSchema, &userSchema)
	require.NoError(t, marshalErr, "failed to unmarshal tenant user schema")

	var userSchemaNoProps jsonschema.Schema
	marshalErr = json.Unmarshal(tenantUserSchemaNoProps, &userSchemaNoProps)
	require.NoError(t, marshalErr, "failed to unmarshal tenant user schema")

	type args struct {
		userSchema     *jsonschema.Schema
		flowDefinition domain.FlowDefinition
	}
	tests := []struct {
		name                string
		args                args
		wantPivotingTargets []domain.PivotingTarget
		wantErr             error
	}{
		{
			name: "valid simple flow definition",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
		},
		{
			name: "valid flow with cycles",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "identify",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"submit":   {},
								"get_help": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit":   {Target: "done"},
								"get_help": {Target: "help"},
							},
						},
						{
							Name: "help",
							Actions: map[string]domain.FlowStepAction{
								"go_back": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"go_back": {Target: "identify"}, // cycle back to identify
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
		},
		{
			name: "valid flow with pivoting",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "start",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"loop":  {},
								"pivot": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"loop":  {Target: "middle"},
								"pivot": {Target: "external-flow", Action: gu.Ptr(domain.Switch)}, // switch to external flow
							},
						},
						{
							Name: "middle",
							Actions: map[string]domain.FlowStepAction{
								"back": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"back": {Target: "start"}, // cycle back to identify
							},
						},
					},
				},
			},
			wantPivotingTargets: []domain.PivotingTarget{
				{
					Name:       "external-flow",
					Step:       "start",
					Transition: "pivot",
				},
			},
		},
		{
			name: "valid with sso providers",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name: "identify",
							SSOProviders: []domain.FlowSSOProvider{
								{
									ID:       "google",
									Name:     "Google",
									Template: "google",
								},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"callback": {Target: "done"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
		},
		{
			name: "invalid with sso providers",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name: "identify",
							SSOProviders: []domain.FlowSSOProvider{
								{
									ID:       "google",
									Name:     "Google",
									Template: "google",
								},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"cancel": {Target: "done"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "identify": has sso_providers but is missing transitions.callback`, nil),
		},
		{
			name: "invalid with inescapable cycle",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "enter"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name: "enter",
							Actions: map[string]domain.FlowStepAction{
								"next": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "trap_a"},
							},
						},
						{
							Name: "trap_a",
							Actions: map[string]domain.FlowStepAction{
								"loop": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"loop": {Target: "trap_b"},
							},
						},
						{
							Name: "trap_b",
							Actions: map[string]domain.FlowStepAction{
								"loop": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"loop": {Target: "trap_a"},
							},
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "enter" is trapped: no path to a terminal step or another flow`, nil),
		},
		{
			name: "invalid with a dead end",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name: "start",
							Actions: map[string]domain.FlowStepAction{
								"next": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "broken_step"},
							},
						},
						{
							Name:   "broken_step",
							Fields: []string{"email"},
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "broken_step" is non-terminal but has no outgoing transitions`, nil),
		},
		{
			name: "invalid flow with unreachable step",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name: "start",
							Actions: map[string]domain.FlowStepAction{
								"next": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "done"},
							},
						},
						{
							Name:   "catch_me_if_you_can",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"next": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "done"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "catch_me_if_you_can" is unreachable from any entry point`, nil),
		},
		{
			name: "invalid flow with a non-terminal step which does nothing",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "doing_nothing"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name: "doing_nothing",
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "done"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "doing_nothing" is non-terminal but has no fields, actions, sso_providers, gates, or transitions.callback`, nil),
		},
		{
			name: "invalid flow with missing entry point in steps",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`purpose "login" targets unknown entry-point step "start"`, nil),
		},
		{
			name: "invalid flow with missing entry point in steps",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`purpose "login" targets unknown entry-point step "start"`, nil),
		},
		{
			name: "invalid flow with no purpose",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`no purposes defined`, nil),
		},
		{
			name: "invalid flow with an invalid purpose",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{6: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`'FlowDefinitionPurpose(6)' is not a valid purpose`, nil),
		},
		{
			name: "invalid flow with no entry step",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1", domain.FlowDefinitionPurposeRegister: ""},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`initial step for purpose 'register' is empty`, nil),
		},
		{
			name: "user schema with no properties",
			args: args{
				userSchema: &userSchemaNoProps,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`user schema has no properties`, nil),
		},
		{
			name: "fields not in user schema",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"username", "password"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": field "username" is not a property in the user schema`, nil),
		},
		{
			name: "invalid flow - a terminal step with fields",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
							Fields:   []string{"email"},
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_2" is terminal (complete is set) but has fields, actions, transitions, gates, or sso_providers`, nil),
		},
		{
			name: "invalid flow - action without a matching transition",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit11": {Target: "step_2"},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": action "submit" has no matching transition`, nil),
		},
		{
			name: "invalid flow - transaction is not a declared action or a reserved outcome",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "start",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"submit": {Primary: true},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit":     {Target: "done"},
								"magic_link": {Target: "done"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "start": transition key "magic_link" is not an action name or reserved outcome (user_not_found, callback)`, nil),
		},
		{
			name: "invalid flow - duplicate step names",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"submit": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "done"},
							},
						},
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"next": {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "done"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`duplicate step name "step_1"`, nil),
		},
		{
			name: "invalid flow - target not a step name",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"submit": {},
								"next":   {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "done"},
								"next":   {Target: "step_2"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": transition "next" targets unknown step "step_2"`, nil),
		},
		{
			name: "invalid flow - target not a step name",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Actions: map[string]domain.FlowStepAction{
								"submit": {},
								"next":   {},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "done"},
								"next":   {Target: "step_2"},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": transition "next" targets unknown step "step_2"`, nil),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := domain.ValidateFlowDefinition(tt.args.userSchema, tt.args.flowDefinition)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Nil(t, got)
				assertErrorDetails(t, err, tt.wantErr)
				return
			}
			assert.Equal(t, tt.wantPivotingTargets, got)
		})
	}
}

func assertErrorDetails(t *testing.T, err error, wantErr error) {
	var gotErr domain.Error
	assert.ErrorAs(t, err, &gotErr)

	var wantDomainErr domain.Error
	assert.ErrorAs(t, wantErr, &wantDomainErr)

	assert.Equal(t, wantDomainErr.Code, gotErr.Code)
	assert.Equal(t, wantDomainErr.Message, gotErr.Message)
	assert.Equal(t, wantDomainErr.Details, gotErr.Details)
}
