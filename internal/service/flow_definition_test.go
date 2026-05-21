package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
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

var flowDefSchema = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": [
    "name",
    "user_schema",
    "purposes",
    "steps"
  ],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$"
    },
    "user_schema": {
      "type": "string",
      "format": "uri"
    },
    "purposes": {
      "type": "object",
      "minProperties": 1,
      "propertyNames": {
        "enum": [
          "login",
          "register",
          "recovery",
          "profiling",
          "reauth",
          "link_account"
        ]
      },
      "additionalProperties": {
        "type": "string"
      }
    },
    "steps": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "name"
        ],
        "properties": {
          "name": {
            "type": "string"
          },
          "fields": {
            "type": "array"
          },
          "on_success": {
            "enum": [
              "create_user"
            ]
          },
          "complete": {
            "enum": [
              "redirect",
              "show"
            ]
          },
          "transitions": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "required": [
                "target"
              ],
              "properties": {
                "target": {
                  "type": "string"
                },
                "action": {
                  "enum": [
                    "switch",
                    "pivot"
                  ]
                }
              }
            }
          }
        }
      }
    }
  }
}`)

var flowDefRaw = []byte(`{
  "name": "simple-login",
  "user_schema": "https://tenant.com/schemas/my-user.json",
  "purposes": {
    "login": "step_1"
  },
  "steps": [
    {
      "name": "step_1",
      "actions": {
        "submit": {
          "primary": true
        }
      },
      "transitions": {
        "submit": {
          "target": "step_2"
        }
      }
    },
    {
      "name": "step_2",
      "complete": "redirect"
    }
  ]
}`)

var invalidFlowDefRaw = []byte(`{
  "name": "Invalid_Flow_Name_With_Caps",
  "user_schema": "just-a-random-string",
  "purposes": {
    "login": "step_1"
  },
  "steps": [
    {
      "name": "step_1",
      "complete": "redirect"
    }
  ]
}`)

var invalidFlowDefJSON = []byte(`{
  "name": "Invalid_Flow_Name_With_Caps",
  "user_schema": "just-a-random-string",
  "purposes": {
    "login": "step_1"
  },
  "steps": [
    {
      "name": "step_1",
      "complete": "redirect"
    },
  ]
}`)

type mockSchemaResolver struct {
	resolveFunc func(
		ctx context.Context,
		client database.QueryExecutor,
		projectID string,
		schemaURL string,
		rootSchema []byte,
	) (*jsonschema.Schema, error)
}

func (m *mockSchemaResolver) Resolve(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
	return m.resolveFunc(ctx, client, projectID, schemaURL, rootSchema)
}

type mockBuiltinSchemaProvider struct {
	getBuiltinSchemaFunc func(uri string) (*jsonschema.Schema, error)
	latestSchemaURIFunc  func(kind domain.KnownSchemaKind) (string, error)
}

func (m *mockBuiltinSchemaProvider) GetBuiltinSchema(uri string) (*jsonschema.Schema, error) {
	return m.getBuiltinSchemaFunc(uri)
}

func (m *mockBuiltinSchemaProvider) LatestSchemaURI(kind domain.KnownSchemaKind) (string, error) {
	return m.latestSchemaURIFunc(kind)
}

func Test_flowDefinitionService_Create(t *testing.T) {
	var userSchema jsonschema.Schema
	marshalErr := json.Unmarshal(tenantUserSchema, &userSchema)
	require.NoError(t, marshalErr, "failed to unmarshal tenant user schema")

	var userSchemaNoProps jsonschema.Schema
	marshalErr = json.Unmarshal(tenantUserSchemaNoProps, &userSchemaNoProps)
	require.NoError(t, marshalErr, "failed to unmarshal tenant user schema")

	var flowDefBuiltin jsonschema.Schema
	marshalErr = json.Unmarshal(flowDefSchema, &flowDefBuiltin)
	require.NoError(t, marshalErr, "failed to unmarshal flow definition schema")

	type fields struct {
		db                    database.Pool
		schemaResolver        service.SchemaResolver
		builtinSchemaProvider service.BuiltinSchemaProvider
		flowDefinitionRepo    func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository
	}
	type args struct {
		ctx context.Context
		req service.CreateFlowDefinitionRequest
	}
	tests := []struct {
		name              string
		fields            fields
		args              args
		want              *domain.FlowDefinition
		wantFlowSchemaURI string
		wantErr           error
	}{
		{
			name: "flow definition created successfully - simple login flow",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					repo.EXPECT().
						CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			want: &domain.FlowDefinition{
				ProjectID:     "project1",
				Name:          "login",
				SchemaVersion: "1.0.0",
				Status:        domain.FlowDefinitionStatusActive,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
				UserSchema: url.URL{
					Scheme: "https",
					Host:   "tenant.com",
					Path:   "/schemas/my-user.json",
				},
				Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
				Audience: domain.FlowDefinitionAudience{
					AppIDs:  []string{"app1"},
					TeamIDs: []string{"team1"},
				},
				Steps: []domain.FlowDefinitionStep{
					{
						Name: "step_1",
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
		{
			name: "flow definition created successfully - login flow with cycles",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					repo.EXPECT().
						CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "cycle-login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
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
					// reusing the same definition since the raw content doesn't matter for this test
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			want: &domain.FlowDefinition{
				ProjectID:     "project1",
				Name:          "cycle-login",
				SchemaVersion: "1.0.0",
				Status:        domain.FlowDefinitionStatusActive,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
				UserSchema: url.URL{
					Scheme: "https",
					Host:   "tenant.com",
					Path:   "/schemas/my-user.json",
				},
				Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
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
		{
			name: "flow definition created successfully - login flow with pivot",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{
							{
								Name: "external-flow",
							},
						}, nil) // the second call to check the existence of the external flow
					repo.EXPECT().
						CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "pivot-login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			want: &domain.FlowDefinition{
				ProjectID:     "project1",
				Name:          "pivot-login",
				SchemaVersion: "1.0.0",
				Status:        domain.FlowDefinitionStatusActive,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
				UserSchema: url.URL{
					Scheme: "https",
					Host:   "tenant.com",
					Path:   "/schemas/my-user.json",
				},
				Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
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
		{
			name: "flow definition created successfully - with sso providers",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					repo.EXPECT().
						CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "sso-login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			want: &domain.FlowDefinition{
				ProjectID:     "project1",
				Name:          "sso-login",
				SchemaVersion: "1.0.0",
				Status:        domain.FlowDefinitionStatusActive,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
				UserSchema: url.URL{
					Scheme: "https",
					Host:   "tenant.com",
					Path:   "/schemas/my-user.json",
				},
				Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
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
		{
			name: "invalid login with sso providers",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "invalid-sso-login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "identify": has sso_providers but is missing transitions.callback`, nil),
		},
		{
			name: "a flow with inescapable cycle",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "trapped-flow",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "enter"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "enter" is trapped: no path to a terminal step or another flow`, nil),
		},
		{
			name: "a flow with a dead-end",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "dead-end",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "broken_step" is non-terminal but has no outgoing transitions`, nil),
		},
		{
			name: "a flow with an unreachable step",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "unreachable-step",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "catch_me_if_you_can" is unreachable from any entry point`, nil),
		},
		{
			name: "a non-terminal step which does nothing",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "do-nothing",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "doing_nothing"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "doing_nothing" is non-terminal but has no fields, actions, sso_providers, gates, or transitions.callback`, nil),
		},
		{
			name: "entry point missing in steps",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "entry-point-missing",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`purpose "login" targets unknown entry-point step "start"`, nil),
		},
		{
			name: "user schema missing properties",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchemaNoProps, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "entry-point-missing",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`user schema has no properties`, nil),
		},
		{
			name: "no purpose set",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "entry-point-missing",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`no purposes defined`, nil),
		},
		{
			name: "purpose is invalid",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "entry-point-missing",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{6: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`'FlowDefinitionPurpose(6)' is not a valid purpose`, nil),
		},
		{
			name: "entry step not set",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "entry-point-missing",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1", domain.FlowDefinitionPurposeRegister: ""},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`initial step for purpose 'register' is empty`, nil),
		},
		{
			name: "fields not in user schema",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "entry-point-missing",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "step_1": field "username" is not a property in the user schema`, nil),
		},
		{
			name: "a terminal step with fields",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "wrong-complete",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "step_2" is terminal (complete is set) but has fields, actions, transitions, gates, or sso_providers`, nil),
		},
		{
			name: "action without a matching transition",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "missing-transition",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "step_1": action "submit" has no matching transition`, nil),
		},
		{
			name: "transaction is not a declared action or a reserved outcome",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "missing-action-transition",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "start"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "start": transition key "magic_link" is not an action name or reserved outcome (user_not_found, callback)`, nil),
		},
		{
			name: "duplicate step names",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "missing-action-transition",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`duplicate step name "step_1"`, nil),
		},
		{
			name: "target not a step",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "some-flow",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "step_1": transition "next" targets unknown step "step_2"`, nil),
		},
		{
			name: "target with a non-existing external flow",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(2).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "some-flow",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
								"next":   {Target: "external-flow", Action: gu.Ptr(domain.Switch)},
							},
						},
						{
							Name:     "done",
							Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
						},
					},
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "step_1": transition "next" targets unknown or inactive flow "external-flow"`, nil),
		},
		{
			name: "failed to create flow definition - db error",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					repo.EXPECT().
						CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(assert.AnError)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantErr: assert.AnError,
		},
		{
			name: "flow definition already exists",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{
							{
								Name: "login",
							},
						}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantErr: domain.ErrFlowDefinitionAlreadyExists(),
		},
		{
			name: "failed to get user schema",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return nil, assert.AnError
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &jsonschema.Schema{}, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantErr: domain.ErrSchemaFetchFailed("failed to resolve tenant user schema", assert.AnError),
		},
		{
			name: "failed to get built-in flow definition schema",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return nil, assert.AnError
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantErr: domain.ErrSchemaFetchFailed("failed to fetch flow definition schema", assert.AnError),
		},
		{
			name: "failed to get latest flow definition schema uri",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "", assert.AnError
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: flowDefRaw,
				},
			},
			wantErr: domain.ErrSchemaFetchFailed("failed to get latest flow definition schema URI", assert.AnError),
		},
		{
			name: "invalid flow definition against schema",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaResolver{
					resolveFunc: func(ctx context.Context, client database.QueryExecutor, projectID string, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error) {
						return &userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
					getBuiltinSchemaFunc: func(uri string) (*jsonschema.Schema, error) {
						return &flowDefBuiltin, nil
					},
					latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
						return "https://example.com/schemas/flow-definition.json", nil
					},
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{}, nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "trapped-flow",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: url.URL{},
					UserSchema: url.URL{
						Scheme: "https",
						Host:   "tenant.com",
						Path:   "/schemas/my-user.json",
					},
					Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
					RawFlowDefinition: invalidFlowDefRaw,
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`flow definition does not conform to schema "https://example.com/schemas/flow-definition.json"`, nil),
		},
	}
	for _, tt := range tests {
		before := time.Now()
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			fd := service.NewFlowDefinitionService(
				tt.fields.db,
				tt.fields.schemaResolver,
				tt.fields.builtinSchemaProvider,
				tt.fields.flowDefinitionRepo(ctrl),
			)
			gotFlowDef, gotFlowSchemaURI, err := fd.Create(tt.args.ctx, tt.args.req)
			after := time.Now()
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assertErrorDetails(t, err, tt.wantErr)
				assert.Nil(t, gotFlowDef)
				assert.Equal(t, "", gotFlowSchemaURI)
				return
			}
			assert.NoError(t, err)
			assert.NotNil(t, gotFlowDef)
			assert.Equal(t, tt.wantFlowSchemaURI, gotFlowSchemaURI)
			assertFlowDefinition(t, gotFlowDef, tt.want, before, after)
		})
	}
}

func assertFlowDefinition(t *testing.T, got, want *domain.FlowDefinition, before, after time.Time) {
	assert.NotEmpty(t, got.ID)
	assert.Equal(t, want.ProjectID, got.ProjectID)
	assert.Equal(t, want.Name, got.Name)
	assert.Equal(t, want.SchemaVersion, got.SchemaVersion)
	assert.Equal(t, want.Status, got.Status)
	assert.Equal(t, want.UserSchema, got.UserSchema)
	assert.Equal(t, want.Purposes, got.Purposes)
	assert.WithinRange(t, got.CreatedAt, before, after)
	assert.WithinRange(t, got.UpdatedAt, before, after)
}

func assertErrorDetails(t *testing.T, err error, wantErr error) {
	var gotErr domain.Error
	if !errors.As(err, &gotErr) {
		assert.ErrorIs(t, err, wantErr)
		return
	}
	assert.ErrorAs(t, err, &gotErr)
	var wantDomainErr domain.Error
	assert.ErrorAs(t, wantErr, &wantDomainErr)

	assert.Equal(t, wantDomainErr.Code, gotErr.Code)
	assert.Equal(t, wantDomainErr.Message, gotErr.Message)
	assert.Equal(t, wantDomainErr.Details, gotErr.Details)
}
