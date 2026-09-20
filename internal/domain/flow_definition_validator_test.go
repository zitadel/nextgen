package domain_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func errorDetails(t *testing.T, err error) string {
	t.Helper()
	var domErr domain.Error
	if !errors.As(err, &domErr) {
		return err.Error()
	}
	if domErr.Details == nil {
		return domErr.Error()
	}
	return fmt.Sprint(domErr.Details)
}

func mustSchema(t *testing.T, raw []byte) *jsonschema.Schema {
	t.Helper()
	var s jsonschema.Schema
	require.NoError(t, json.Unmarshal(raw, &s))
	return &s
}

var tenantUserSchemaNoAuthMethod = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/no-auth-methods.json",
  "type": "object",
  "x-identifier": "email",
  "required": ["email"],
  "properties": {
    "email": { "type": "string", "format": "email", "x-unique": "team" }
  }
}`)

var tenantUserSchemaEmptyAuthMethod = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/empty-auth-methods.json",
  "type": "object",
  "x-identifier": "email",
  "required": ["email"],
  "x-auth-methods": {},
  "properties": {
    "email":    { "type": "string", "format": "email", "x-unique": "team" }
  }
}`)

var tenantUserSchemaDisabledAuthMethod = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/disabled-auth-user.json",
  "type": "object",
  "x-identifier": "email",
  "required": ["email"],
  "x-auth-methods": {
    "password": { "enabled": false }
  },
  "properties": {
    "email":    { "type": "string", "format": "email", "x-unique": "team" }
  }
}`)

var userSchemaIDAndPassword = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/idpw-user.json",
  "type": "object",
  "x-identifier": "email",
  "required": ["email"],
  "x-auth-methods": {
    "password": { "enabled": true }
  },
  "properties": {
    "email":    { "type": "string", "format": "email", "x-unique": "team" }
  }
}`)

var userSchemaPasskeyEnabled = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/passkey-user.json",
  "type": "object",
  "x-identifier": "email",
  "required": ["email"],
  "x-auth-methods": {
    "password": { "enabled": true },
    "passkey":  { "enabled": true }
  },
  "properties": {
    "email":    { "type": "string", "format": "email", "x-unique": "team" }
  }
}`)

var userSchemaPasskeyDisabled = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/passkey-disabled-user.json",
  "type": "object",
  "x-identifier": "email",
  "required": ["email"],
  "x-auth-methods": {
    "password": { "enabled": true },
    "passkey":  { "enabled": false }
  },
  "properties": {
    "email":    { "type": "string", "format": "email", "x-unique": "team" }
  }
}`)

var userSchemaRequiredProps = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/idpw-user.json",
  "type": "object",
  "required": ["email", "first_name", "last_name"],
  "x-auth-methods": {
    "password": { "enabled": true }
  },
  "properties": {
    "email":    { "type": "string", "format": "email", "x-unique": "team" },
	"first_name": { "type": "string" },
	"last_name": { "type": "string" },
	"age": { "type": "integer" }
  }
}`)

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
      "enabled": true
    }
  },
  "properties": {
    "email": {
      "title": "Email Address",
      "type": "string",
      "format": "email",
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
      "enabled": true
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

	var userSchemaNoAuthMethod jsonschema.Schema
	marshalErr = json.Unmarshal(tenantUserSchemaNoAuthMethod, &userSchemaNoAuthMethod)
	require.NoError(t, marshalErr, "failed to unmarshal tenant user schema")

	var userSchemaEmptyAuthMethod jsonschema.Schema
	marshalErr = json.Unmarshal(tenantUserSchemaEmptyAuthMethod, &userSchemaEmptyAuthMethod)
	require.NoError(t, marshalErr, "failed to unmarshal tenant user schema")

	var userSchemaDisabledAuthMethod jsonschema.Schema
	marshalErr = json.Unmarshal(tenantUserSchemaDisabledAuthMethod, &userSchemaDisabledAuthMethod)
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
			name: "valid flow definition with password",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/idpw-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []domain.Field{"email", "x-auth-methods#password"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "get_help", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit":   {Target: "done"},
								"get_help": {Target: "help"},
							},
						},
						{
							Name: "help",
							Actions: []domain.FlowStepAction{
								{Name: "go_back", Kind: domain.FlowActionKindNavigate},
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
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "loop", Kind: domain.FlowActionKindSubmit},

								{Name: "pivot", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"loop":  {Target: "middle"},
								"pivot": {Target: "external-flow", Action: gu.Ptr(domain.Switch)}, // switch to external flow
							},
						},
						{
							Name: "middle",
							Actions: []domain.FlowStepAction{
								{Name: "restart", Kind: domain.FlowActionKindNavigate},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"restart": {Target: "start"}, // cycle back to identify
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
							Fields: []domain.Field{
								"email",
							},
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
							Fields: []domain.Field{
								"email",
							},
							Actions: []domain.FlowStepAction{
								{Name: "next", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "trap_a"},
							},
						},
						{
							Name: "trap_a",
							Actions: []domain.FlowStepAction{
								{Name: "loop", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"loop": {Target: "trap_b"},
							},
						},
						{
							Name: "trap_b",
							Actions: []domain.FlowStepAction{
								{Name: "loop", Kind: domain.FlowActionKindSubmit},
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
							Actions: []domain.FlowStepAction{
								{Name: "next", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "broken_step"},
							},
						},
						{
							Name:   "broken_step",
							Fields: []domain.Field{"email"},
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
							Actions: []domain.FlowStepAction{
								{Name: "next", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"next": {Target: "done"},
							},
						},
						{
							Name:   "catch_me_if_you_can",
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "next", Kind: domain.FlowActionKindSubmit},
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
			name: "schema with without auth methods",
			args: args{
				userSchema: &userSchemaNoAuthMethod,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/no-auth-methods.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []domain.Field{"email", "x-auth-methods#password"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": "password" is not an enabled authentication method`, nil),
		},
		{
			name: "schema with empty auth methods",
			args: args{
				userSchema: &userSchemaEmptyAuthMethod,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/empty-auth-methods.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []domain.Field{"email", "x-auth-methods#password"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": "password" is not an enabled authentication method`, nil),
		},
		{
			name: "auth method disabled",
			args: args{
				userSchema: &userSchemaNoAuthMethod,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/disabled-auth-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []domain.Field{"email", "x-auth-methods#password"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": "password" is not an enabled authentication method`, nil),
		},
		{
			name: "invalid auth method name",
			args: args{
				userSchema: &userSchema,
				flowDefinition: domain.FlowDefinition{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					UserSchema:    "https://tenant.com/schemas/idpw-user.json",
					Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []domain.Field{"email", "x-auth-methods#INVALID"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": unknown field type for "x-auth-methods#INVALID"`, nil),
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
							Fields: []domain.Field{"email", "username", "firstName"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid(`step "step_1": flow field: not a property in the user schema: "username"`, nil),
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
							Fields: []domain.Field{"email"},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
							Fields:   []domain.Field{"email"},
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
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
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
			wantErr: domain.ErrFlowDefinitionInvalid(`step "start": transition key "magic_link" is not an action name or reserved outcome (user_not_found, user_already_exists, identity_unknown, callback)`, nil),
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
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "done"},
							},
						},
						{
							Name:   "step_1",
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "next", Kind: domain.FlowActionKindSubmit},
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
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
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
							Fields: []domain.Field{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
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

			assert.NoError(t, err)
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

// ---- Flip-table coverage ----

// Combined login + register entry must wire the counter outcome
// (user_not_found or user_already_exists).
func TestValidator_FlipTable_CombinedLoginRegisterRequiresCounterOutcome(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "combined",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identify",
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "signin"},
				},
			},
			{
				Name:      "signin",
				Fields:    []domain.Field{"email", "x-auth-methods#password"},
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	details := errorDetails(t, err)
	// Map iteration order is non-deterministic; either missing flip
	// outcome is a valid surfacing.
	assert.True(t,
		strings.Contains(details, "user_not_found") || strings.Contains(details, "user_already_exists"),
		"want flip-coverage error, got: %s", details)
}

// Solo-purpose login flow does NOT need user_not_found wired.
func TestValidator_FlipTable_SoloLoginNoFlipRequired(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "solo-login",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "credentials",
				Fields: []domain.Field{"email", "x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.NoError(t, err)
}

// ---- on_success manifest cross-check ----

// create_user must have password collected somewhere upstream.
func TestValidator_Manifest_CreateUserRequiresPasswordUpstream(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "missing-password",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "create"},
				},
			},
			{
				Name:      "create",
				Fields:    []domain.Field{"email"},
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), "password")
}

// Worked example A: register-only, multi-step. Identifier on profile,
// password on set-password, create_user on confirm.
func TestValidator_PositiveWorkedExampleA(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "multi-signup",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "profile",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "profile",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "set-password"},
				},
			},
			{
				Name:   "set-password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "confirm"},
				},
			},
			{
				Name:      "confirm",
				Fields:    []domain.Field{"email"},
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.NoError(t, err)
}

// Worked example C: combined login+register with both flip outcomes wired.
func TestValidator_PositiveWorkedExampleC(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "combined",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identify",
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit":              {Target: "signin"},
					"user_not_found":      {Target: "register"},
					"user_already_exists": {Target: "signin"},
				},
			},
			{
				Name:   "signin",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{
				Name:      "register",
				Fields:    []domain.Field{"email", "x-auth-methods#password"},
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.NoError(t, err)
}

// TestValidator_DuplicateActionRejected pins ADR 021: with Actions as an
// ordered slice, two entries sharing a name are no longer collapsed by map
// semantics; the validator must reject them.
func TestValidator_DuplicateActionRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/idpw-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "step", Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "submit", Kind: domain.FlowActionKindSubmit},
				},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "done"}},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), `duplicate action "submit"`)
}

// TestValidator_EmptyActionNameRejected guards against array entries lacking
// the required name selector.
func TestValidator_EmptyActionNameRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/idpw-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "step", Fields: []domain.Field{"email"},
				Actions:     []domain.FlowStepAction{{Primary: true}},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "done"}},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), "action has empty name")
}

// TestValidator_MissingActionKindRejected guards against actions declared
// without the required `kind` field — the engine has no way to decide how
// to route an action whose kind is unset.
func TestValidator_MissingActionKindRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/idpw-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "step", Fields: []domain.Field{"email"},
				Actions:     []domain.FlowStepAction{{Name: "submit"}},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "done"}},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), `action "submit" has no kind`)
}

// TestValidator_DeclaredBackKindRejected guards against authors declaring
// `kind: back` directly on a flow definition. The engine injects back on
// rendered responses; declaring it on the definition would let an author
// override the engine's reversibility rules and is not permitted.
func TestValidator_DeclaredBackKindRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/idpw-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "step", Fields: []domain.Field{"email"},
				Actions:     []domain.FlowStepAction{{Name: "back", Kind: domain.FlowActionKindBack}},
				Transitions: map[string]domain.FlowStepTransition{"back": {Target: "done"}},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), `action "back" has kind=back, which is engine-injected and cannot be declared`)
}

// TestValidator_ReservedBackNameRejected guards the action name "back"
// itself. Even with a non-back kind, an authored action named "back"
// would collide at render time with the engine-injected back action —
// the client would see two "back" buttons and route to the customer's
// kind rather than the injected one.
func TestValidator_ReservedBackNameRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/idpw-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "step", Fields: []domain.Field{"email"},
				Actions:     []domain.FlowStepAction{{Name: "back", Kind: domain.FlowActionKindNavigate}},
				Transitions: map[string]domain.FlowStepTransition{"back": {Target: "done"}},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), `action name "back" is reserved for engine-injected back navigation`)
}

func TestValidator_MissingRequiredUserSchemaFields(t *testing.T) {
	schema := mustSchema(t, userSchemaRequiredProps)
	def := domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/idpw-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identifier"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "identifier", Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "profile"}},
			},
			{
				Name: "profile", Fields: []domain.Field{"given_name", "family_name", "date_of_birth"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "done"}},
			},
			{Name: "done", Complete: new(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(`required fields [first_name last_name] in user schema are missing in the flow definition steps`, nil))
}

// userSchemaRequiredNested makes `address` required and gives it a
// required leaf of its own, so coverage has to be checked one level
// down. `billing` is required but declares no `required`, so any leaf
// beneath it covers the object. `shipping` is optional with a required
// leaf, and `address.geo` is the same shape one level down inside a
// required object — neither is demanded until a step collects into it.
var userSchemaRequiredNested = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/nested-user.json",
  "type": "object",
  "required": ["email", "address", "billing"],
  "x-auth-methods": {
    "password": { "enabled": true, "position": 0 }
  },
  "properties": {
    "email": { "type": "string", "format": "email", "x-unique": "team" },
    "address": {
      "type": "object",
      "required": ["street"],
      "properties": {
        "street": { "type": "string" },
        "city": { "type": "string" },
        "geo": {
          "type": "object",
          "required": ["lat"],
          "properties": {
            "lat": { "type": "string" },
            "lng": { "type": "string" }
          }
        }
      }
    },
    "billing": {
      "type": "object",
      "properties": { "vat_id": { "type": "string" } }
    },
    "shipping": {
      "type": "object",
      "required": ["street"],
      "properties": {
        "street": { "type": "string" },
        "city": { "type": "string" }
      }
    }
  }
}`)

// nestedRequiredFlow builds a login flow whose profile step collects the
// given fields, so cases vary only by what the step declares.
func nestedRequiredFlow(fields []domain.Field) domain.FlowDefinition {
	return domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/nested-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identifier"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "identifier", Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "profile"}},
			},
			{
				Name: "profile", Fields: fields,
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "done"}},
			},
			{Name: "done", Complete: new(domain.FlowStepCompleteShow)},
		},
	}
}

func TestValidator_RequiredNestedUserSchemaFields(t *testing.T) {
	schema := mustSchema(t, userSchemaRequiredNested)

	t.Run("nested required leaf satisfies coverage", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address.street", "billing.vat_id"},
		))
		require.NoError(t, err)
	})

	t.Run("missing nested required leaf is reported by its path", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address.city", "billing.vat_id"},
		))
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(
			`required fields [address.street] in user schema are missing in the flow definition steps`, nil))
	})

	t.Run("required object without its own required is covered by any leaf", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address.street"},
		))
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(
			`required fields [billing] in user schema are missing in the flow definition steps`, nil))
	})

	// The resolver's own fixture, driven through the save path: the
	// resolver cases prove a dotted field resolves, this proves the
	// definition carrying it is accepted.
	t.Run("the resolver's nested fixture saves", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(
			mustSchema(t, []byte(nestedSchemaContent)),
			nestedRequiredFlow([]domain.Field{"address.street"}),
		)
		require.NoError(t, err)
	})

	// An optional object exists in the collected document only because a
	// step collected something beneath it, and from that point the
	// document validator enforces its `required` list. Without this the
	// definition saved and then failed at create_user on every submission.
	t.Run("collecting into an optional object demands its own required leaf", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address.street", "billing.vat_id", "shipping.city"},
		))
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(
			`required fields [shipping.street] in user schema are missing in the flow definition steps`, nil))
	})

	t.Run("collecting an optional object's required leaf satisfies it", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address.street", "billing.vat_id", "shipping.street", "shipping.city"},
		))
		require.NoError(t, err)
	})

	t.Run("an optional object no step collects into demands nothing", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address.street", "billing.vat_id"},
		))
		require.NoError(t, err)
	})

	// The same rule one level down: `geo` is optional inside `address`,
	// which is itself required, so the descent has to keep alternating
	// between required names and materialized ones.
	t.Run("collecting into an optional object nested in a required one demands its leaf", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address.street", "billing.vat_id", "address.geo.lng"},
		))
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(
			`required fields [address.geo.lat] in user schema are missing in the flow definition steps`, nil))
	})

	// Naming the object itself used to resolve as a text input and only
	// fail once the user submitted it, at create_user.
	t.Run("naming the object itself is rejected at definition time", func(t *testing.T) {
		_, err := domain.ValidateFlowDefinition(schema, nestedRequiredFlow(
			[]domain.Field{"address", "address.street", "billing.vat_id"},
		))
		require.Error(t, err)
		assert.Contains(t, errorDetails(t, err), domain.ErrFlowFieldNotScalar.Error())
	})
}

// ---- Passkey action enablement ----

// passkeyActionFlow builds a minimal login flow whose entry step offers
// a WebAuthn action of the given kind next to a plain submit.
func passkeyActionFlow(actionName string, kind domain.FlowActionKind) domain.FlowDefinition {
	return domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/passkey-user.json",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "step", Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: actionName, Kind: kind},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit":   {Target: "done"},
					actionName: {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
}

func TestValidator_PasskeyActionRejectedWhenSchemaDisablesPasskey(t *testing.T) {
	schema := mustSchema(t, userSchemaPasskeyDisabled)
	_, err := domain.ValidateFlowDefinition(schema, passkeyActionFlow("passkey", domain.FlowActionKindPasskey))
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err),
		`step "step": action "passkey" offers passkey but "passkey" is not an enabled authentication method`)
}

// An absent passkey entry counts as disabled, matching the field-shaped
// precedent for x-auth-methods#password.
func TestValidator_PasskeyActionRejectedWhenSchemaOmitsPasskey(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	_, err := domain.ValidateFlowDefinition(schema, passkeyActionFlow("passkey", domain.FlowActionKindPasskey))
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err),
		`step "step": action "passkey" offers passkey but "passkey" is not an enabled authentication method`)
}

func TestValidator_PasskeyRegisterActionRejectedWhenSchemaDisablesPasskey(t *testing.T) {
	schema := mustSchema(t, userSchemaPasskeyDisabled)
	_, err := domain.ValidateFlowDefinition(schema, passkeyActionFlow("enroll", domain.FlowActionKindPasskeyRegister))
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err),
		`step "step": action "enroll" offers passkey but "passkey" is not an enabled authentication method`)
}

func TestValidator_PasskeyActionsAcceptedWhenSchemaEnablesPasskey(t *testing.T) {
	schema := mustSchema(t, userSchemaPasskeyEnabled)
	_, err := domain.ValidateFlowDefinition(schema, passkeyActionFlow("passkey", domain.FlowActionKindPasskey))
	assert.NoError(t, err)
	_, err = domain.ValidateFlowDefinition(schema, passkeyActionFlow("enroll", domain.FlowActionKindPasskeyRegister))
	assert.NoError(t, err)
}

// purposedNavDef builds a two-purpose definition whose identifier step
// carries a navigate action with a purposed transition; mutate overrides
// the transition before validation.
func purposedNavDef(mutate func(t *domain.FlowStepTransition)) domain.FlowDefinition {
	tr := domain.FlowStepTransition{
		Target:  "register",
		Purpose: gu.Ptr(domain.FlowDefinitionPurposeRegister),
	}
	if mutate != nil {
		mutate(&tr)
	}
	return domain.FlowDefinition{
		ProjectID: "p", Name: "f", SchemaVersion: "1",
		UserSchema: "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identifier",
			domain.FlowDefinitionPurposeRegister: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "identifier", Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "register", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit":                               {Target: "done"},
					"register":                             tr,
					domain.FlowImplicitOutcomeUserNotFound: {Target: "register"},
				},
			},
			{
				Name: "register", Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "identifier"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
}

// A well-formed purposed navigation — to a served purpose, targeting its
// entry step, without a cross-flow action — validates.
func TestValidator_TransitionPurposeAccepted(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	_, err := domain.ValidateFlowDefinition(schema, purposedNavDef(nil))
	require.NoError(t, err)
}

// A transition cannot both re-purpose locally and target another flow.
func TestValidator_TransitionPurposeWithActionRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := purposedNavDef(func(tr *domain.FlowStepTransition) {
		tr.Action = gu.Ptr(domain.Switch)
	})
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), "declares both purpose and action")
}

// The declared purpose must be one this definition serves.
func TestValidator_TransitionPurposeNotServedRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := purposedNavDef(func(tr *domain.FlowStepTransition) {
		tr.Purpose = gu.Ptr(domain.FlowDefinitionPurposeRecovery)
	})
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), `re-purposes to "recovery", which this definition does not serve`)
}

// The purposed transition must land on the declared purpose's entry step.
func TestValidator_TransitionPurposeWrongTargetRejected(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := purposedNavDef(func(tr *domain.FlowStepTransition) {
		tr.Target = "done"
	})
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), `must target that purpose's entry step "register"`)
}
