package service_test

import (
	"context"
	"encoding/json"
	"errors"
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
	require.NoError(t, marshalErr, "failed to unmarshal user schema")

	var userSchemaNoProps jsonschema.Schema
	marshalErr = json.Unmarshal(tenantUserSchemaNoProps, &userSchemaNoProps)
	require.NoError(t, marshalErr, "failed to unmarshal user schema")

	var flowDefBuiltin jsonschema.Schema
	marshalErr = json.Unmarshal(flowDefSchema, &flowDefBuiltin)
	require.NoError(t, marshalErr, "failed to unmarshal flow definition schema")

	type fields struct {
		db                    database.Pool
		schemaResolver        service.SchemaResolver
		builtinSchemaProvider service.BuiltinSchemaProvider
		validatorFn           func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error)
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
			name: "flow definition created successfully",
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
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
				UserSchema:    "https://tenant.com/schemas/my-user.json",
				Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
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
			name: "flow definition created successfully - target with an existing external flow",
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
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return []domain.PivotingTarget{
						{
							Name:       "external-flow",
							Step:       "step_1",
							Transition: "next",
						},
					}, nil
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
								Name:   "external-flow",
								Status: domain.FlowDefinitionStatusActive,
							},
						}, nil)
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
					Name:          "some-flow",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
			want: &domain.FlowDefinition{
				ProjectID:     "project1",
				Name:          "some-flow",
				SchemaVersion: "1.0.0",
				Status:        domain.FlowDefinitionStatusActive,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
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
							"next":   {Target: "external-flow", Action: gu.Ptr(domain.Switch)},
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
			name: "flow definition created successfully - list flow definitions - no rows found error",
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
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return []domain.PivotingTarget{}, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return(nil, &database.NoRowFoundError{})
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
							"next":   {Target: "external-flow", Action: gu.Ptr(domain.Switch)},
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
			name: "failed to create flow definition - target with a non-existing external flow",
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
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return []domain.PivotingTarget{
						{
							Name:       "external-flow",
							Step:       "step_1",
							Transition: "next",
						},
					}, nil
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
			name: "failed to create flow definition - validation failed",
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
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, domain.ErrFlowDefinitionInvalid("validation failed", assert.AnError)
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
			wantErr: domain.ErrFlowDefinitionInvalid("validation failed", assert.AnError),
		},
		{
			name: "failed to create flow definition - db error while creating",
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
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return []domain.PivotingTarget{}, nil
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
			name: "failed to create flow definition - db error while listing flow definitions",
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
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return []domain.PivotingTarget{}, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
						Times(1).
						Return(nil, assert.AnError)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.CreateFlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					SchemaVersion: "1.0.0",
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
			wantErr: domain.ErrSchemaFetchFailed("failed to resolve user schema", assert.AnError),
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
					FlowSchemaURI: "",
					UserSchema:    "https://tenant.com/schemas/my-user.json",
					Purposes:      map[string]string{"login": "step_1"},
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
	}
	for _, tt := range tests {
		before := time.Now()
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			fd := service.NewFlowDefinitionService(
				tt.fields.db,
				tt.fields.schemaResolver,
				tt.fields.builtinSchemaProvider,
				tt.fields.validatorFn,
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
