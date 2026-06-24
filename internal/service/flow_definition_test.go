package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
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

type mockSchemaGetter struct {
	getSchema func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error)
}

func (m *mockSchemaGetter) GetSchema(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
	return m.getSchema(ctx, projectID, teamID, schemaID)
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
	userSchema := &domain.JSONSchema{
		Schema: tenantUserSchema,
	}

	type fields struct {
		db                    database.Pool
		schemaResolver        service.SchemaGetter
		builtinSchemaProvider service.BuiltinSchemaProvider
		validatorFn           func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error)
		flowDefinitionRepo    func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository
	}
	type args struct {
		ctx context.Context
		req service.FlowDefinitionRequest
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
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
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
				req: service.FlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					Status:        "Active",
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
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
						Actions: []domain.FlowStepAction{
							{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
						},
					},
					{
						Name:     "step_2",
						Complete: new(domain.FlowStepCompleteRedirect),
					},
				},
			},
		},
		{
			name: "flow definition created successfully - target with an existing external flow",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
					},
				},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{
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
				req: service.FlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "some-flow",
					Status:        "active",
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "done"},
								"next":   {Target: "external-flow", Action: new(domain.Switch)},
							},
						},
						{
							Name:     "done",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
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
						Actions: []domain.FlowStepAction{
							{Name: "submit", Kind: domain.FlowActionKindSubmit},

							{Name: "next", Kind: domain.FlowActionKindSubmit},
						},
						Transitions: map[string]domain.FlowStepTransition{
							"submit": {Target: "done"},
							"next":   {Target: "external-flow", Action: new(domain.Switch)},
						},
					},
					{
						Name:     "done",
						Complete: new(domain.FlowStepCompleteRedirect),
					},
				},
			},
		},
		{
			name: "flow definition created successfully - list flow definitions - no rows found error",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
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
				req: service.FlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					Status:        "active",
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
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
						Actions: []domain.FlowStepAction{
							{Name: "submit", Kind: domain.FlowActionKindSubmit},

							{Name: "next", Kind: domain.FlowActionKindSubmit},
						},
						Transitions: map[string]domain.FlowStepTransition{
							"submit": {Target: "done"},
							"next":   {Target: "external-flow", Action: new(domain.Switch)},
						},
					},
					{
						Name:     "done",
						Complete: new(domain.FlowStepCompleteRedirect),
					},
				},
			},
		},
		{
			name: "failed to create flow definition - target with a non-existing external flow",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
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
				req: service.FlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "some-flow",
					Status:        "active",
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "done"},
								"next":   {Target: "external-flow", Action: new(domain.Switch)},
							},
						},
						{
							Name:     "done",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "step_1": transition "next" targets unknown or inactive flow "external-flow"`, nil),
		},
		{
			name: "failed to create flow definition - validation failed",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
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
				req: service.FlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "some-flow",
					Status:        "active",
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "done"},
								"next":   {Target: "external-flow", Action: new(domain.Switch)},
							},
						},
						{
							Name:     "done",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionInvalid("validation failed", assert.AnError),
		},
		{
			name: "failed to create flow definition - db error while creating",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
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
				req: service.FlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					Status:        "active",
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: assert.AnError,
		},
		{
			name: "failed to create flow definition - db error while listing flow definitions",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
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
				req: service.FlowDefinitionRequest{
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: assert.AnError,
		},
		{
			name: "flow definition already exists",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
						return userSchema, nil
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
				req: service.FlowDefinitionRequest{
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrFlowDefinitionAlreadyExists(),
		},
		{
			name: "failed to get user schema",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{
					getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
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
				req: service.FlowDefinitionRequest{
					ProjectID:     "project1",
					Name:          "login",
					Status:        "active",
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
						},
						{
							Name:     "step_2",
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: domain.ErrSchemaFetchFailed("failed to fetch user schema", assert.AnError),
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
			gotFlowDef, err := fd.Create(tt.args.ctx, tt.args.req)
			after := time.Now()
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assertErrorDetails(t, err, tt.wantErr)
				assert.Nil(t, gotFlowDef)
				return
			}
			assert.NoError(t, err)
			assert.NotNil(t, gotFlowDef)
			assertFlowDefinition(t, gotFlowDef, tt.want, before, after)
		})
	}
}

func Test_flowDefinitionService_Update(t *testing.T) {
	userSchema := &domain.JSONSchema{Schema: tenantUserSchema}

	type fields struct {
		db                    database.Pool
		schemaResolver        service.SchemaGetter
		builtinSchemaProvider service.BuiltinSchemaProvider
		validatorFn           func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error)
		flowDefinitionRepo    func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository
	}
	type args struct {
		ctx context.Context
		req service.FlowDefinitionRequest
	}

	tests := []struct {
		name    string
		fields  fields
		args    args
		want    *domain.FlowDefinition
		wantErr error
	}{
		{
			name: "flow definition updated successfully (draft to active)",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
					return "https://example.com/schemas/flow-definition.json", nil
				}},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{ID: "flowdef_123", ProjectID: "project1", Name: "old-flow", Status: domain.FlowDefinitionStatusDraft}, nil)
					repo.EXPECT().
						UpdateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.FlowDefinitionRequest{
					FlowDefinitionID: "flowdef_123",
					ProjectID:        "project1",
					Name:             "login-updated",
					Status:           "active",
					SchemaVersion:    "1.1.0",
					UserSchema:       "https://tenant.com/schemas/my-user.json",
					Purposes:         map[string]string{"login": "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
						},
						{Name: "step_2", Complete: new(domain.FlowStepCompleteRedirect)},
					},
				},
			},
			want: &domain.FlowDefinition{
				ID:            "flowdef_123",
				ProjectID:     "project1",
				Name:          "login-updated",
				SchemaVersion: "1.1.0",
				Status:        domain.FlowDefinitionStatusActive,
				UserSchema:    "https://tenant.com/schemas/my-user.json",
				Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
			},
		},
		{
			name: "flow definition updated successfully - draft status unchanged",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
					return "https://example.com/schemas/flow-definition.json", nil
				}},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{ID: "flowdef_123", ProjectID: "project1", Name: "old-flow", Status: domain.FlowDefinitionStatusDraft}, nil)
					repo.EXPECT().
						UpdateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(nil)
					return repo
				},
			},
			args: args{
				ctx: context.Background(),
				req: service.FlowDefinitionRequest{
					FlowDefinitionID: "flowdef_123",
					ProjectID:        "project1",
					Name:             "login-updated",
					Status:           "draft",
					SchemaVersion:    "1.1.0",
					UserSchema:       "https://tenant.com/schemas/my-user.json",
					Purposes:         map[string]string{"login": "step_1"},
					Audience: domain.FlowDefinitionAudience{
						AppIDs:  []string{"app1"},
						TeamIDs: []string{"team1"},
					},
					Steps: []domain.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
							},
							Transitions: map[string]domain.FlowStepTransition{
								"submit": {Target: "step_2"},
							},
						},
						{Name: "step_2", Complete: new(domain.FlowStepCompleteRedirect)},
					},
				},
			},
			want: &domain.FlowDefinition{
				ID:            "flowdef_123",
				ProjectID:     "project1",
				Name:          "login-updated",
				SchemaVersion: "1.1.0",
				Status:        domain.FlowDefinitionStatusDraft,
				UserSchema:    "https://tenant.com/schemas/my-user.json",
				Purposes:      map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step_1"},
			},
		},
		{
			name: "flow definition not found",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_missing").
						Times(1).
						Return(nil, &database.NoRowFoundError{})
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_missing",
				ProjectID:        "project1",
				Name:             "login",
				SchemaVersion:    "1.0.0",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes:         map[string]string{"login": "step_1"},
				Steps:            []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			wantErr: domain.ErrFlowDefinitionNotFound(),
		},
		{
			name: "invalid purpose",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{ID: "flowdef_123", ProjectID: "project1"}, nil)
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_123",
				ProjectID:        "project1",
				Name:             "login",
				Status:           "active",
				SchemaVersion:    "1.0.0",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes:         map[string]string{"not-a-purpose": "step_1"},
				Steps:            []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			wantErr: domain.ErrFlowDefinitionInvalid("invalid purpose", nil),
		},
		{
			name: "validation fails",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, domain.ErrFlowDefinitionInvalid("validation failed", assert.AnError)
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{ID: "flowdef_123", ProjectID: "project1"}, nil)
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_123",
				ProjectID:        "project1",
				Name:             "login",
				SchemaVersion:    "1.0.0",
				Status:           "active",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes:         map[string]string{"login": "step_1"},
				Steps:            []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			wantErr: domain.ErrFlowDefinitionInvalid("validation failed", assert.AnError),
		},
		{
			name: "missing status in update request returns an error",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{ID: "flowdef_123", ProjectID: "project1"}, nil)
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_123",
				ProjectID:        "project1",
				Name:             "login",
				SchemaVersion:    "1.0.0",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes:         map[string]string{"login": "step_1"},
				Steps:            []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			wantErr: domain.ErrFlowDefinitionInvalid("invalid status: \"\"", nil),
		},
		{
			name: "deactivate fails - only self is active for purpose",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{
							ID:        "flowdef_123",
							ProjectID: "project1",
							Status:    domain.FlowDefinitionStatusActive,
							Purposes: map[domain.FlowDefinitionPurpose]string{
								domain.FlowDefinitionPurposeLogin: "step_1",
							},
						}, nil)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any(), gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{
							{ID: "flowdef_123", Status: domain.FlowDefinitionStatusActive},
						}, nil)
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_123",
				ProjectID:        "project1",
				Name:             "login",
				Status:           "draft",
				SchemaVersion:    "1.0.0",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes:         map[string]string{"login": "step_1"},
				Steps:            []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			wantErr: domain.ErrFlowDefinitionUpdateConflict("cannot update: no other active flow definition found with purpose \"login\""),
		},
		//{
		//	name: "deactivate blocked - multi-purpose missing active alternative for one purpose",
		//	fields: fields{
		//		db: stubPool(),
		//		schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
		//			return userSchema, nil
		//		}},
		//		builtinSchemaProvider: &mockBuiltinSchemaProvider{},
		//		validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
		//			return nil, nil
		//		},
		//		flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
		//			repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
		//			repo.EXPECT().
		//				GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
		//				Times(1).
		//				Return(&domain.FlowDefinition{
		//					ID:        "flowdef_123",
		//					ProjectID: "project1",
		//					Status:    domain.FlowDefinitionStatusActive,
		//					Purposes: map[domain.FlowDefinitionPurpose]string{
		//						domain.FlowDefinitionPurposeLogin:    "step_1",
		//						domain.FlowDefinitionPurposeRegister: "step_1",
		//					},
		//				}, nil)
		//
		//			// login has another active
		//			repo.EXPECT().
		//				ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any(), gomock.Any()).
		//				Times(1).
		//				Return([]*domain.FlowDefinition{
		//					{ID: "flowdef_123", Status: domain.FlowDefinitionStatusActive},
		//					{ID: "flowdef_other_login", Status: domain.FlowDefinitionStatusActive},
		//				}, nil)
		//
		//			// register has only self active
		//			repo.EXPECT().
		//				ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any(), gomock.Any()).
		//				Times(1).
		//				Return([]*domain.FlowDefinition{
		//					{ID: "flowdef_123", Status: domain.FlowDefinitionStatusActive},
		//				}, nil)
		//
		//			return repo
		//		},
		//	},
		//	args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
		//		FlowDefinitionID: "flowdef_123",
		//		ProjectID:        "project1",
		//		Name:             "login-register",
		//		Status:           "draft",
		//		SchemaVersion:    "1.0.0",
		//		UserSchema:       "https://tenant.com/schemas/my-user.json",
		//		Purposes: map[string]string{
		//			"login":    "step_1",
		//			"register": "step_1",
		//		},
		//		Steps: []domain.FlowDefinitionStep{{Name: "step_1"}},
		//	}},
		//	wantErr: domain.ErrFlowDefinitionUpdateConflict("cannot update: no other active flow definition found with purpose \"register\""),
		//},
		//{
		//	name: "deactivate allowed - all purposes have another active definition", fields: fields{
		//		db: stubPool(),
		//		schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
		//			return userSchema, nil
		//		}},
		//		builtinSchemaProvider: &mockBuiltinSchemaProvider{},
		//		validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
		//			return nil, nil
		//		},
		//		flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
		//			repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
		//			repo.EXPECT().
		//				GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
		//				Times(1).
		//				Return(&domain.FlowDefinition{
		//					ID:        "flowdef_123",
		//					ProjectID: "project1",
		//					Status:    domain.FlowDefinitionStatusActive,
		//					Purposes: map[domain.FlowDefinitionPurpose]string{
		//						domain.FlowDefinitionPurposeLogin:    "step_1",
		//						domain.FlowDefinitionPurposeRegister: "step_1",
		//					},
		//				}, nil)
		//			// todo (@grvijayan): this is flaky at the moment due to the order of the calls based on map keys
		//			//  but as we anyway plan to refactor fetching the flow definitions, this will be resolved as part of that refactor
		//			// login purpose
		//			repo.EXPECT().
		//				ListFlowDefinitions(
		//					gomock.Any(),
		//					gomock.Any(),
		//					"project1",
		//					gomock.Any(),
		//				).
		//				Times(1).
		//				Return([]*domain.FlowDefinition{
		//					{ID: "flowdef_123", Status: domain.FlowDefinitionStatusActive},
		//					{ID: "flowdef_other_login", Status: domain.FlowDefinitionStatusActive},
		//				}, nil)
		//
		//			// register purpose
		//			repo.EXPECT().
		//				ListFlowDefinitions(
		//					gomock.Any(),
		//					gomock.Any(),
		//					"project1",
		//					gomock.Any(),
		//				).
		//				Times(1).
		//				Return([]*domain.FlowDefinition{
		//					{ID: "flowdef_123", Status: domain.FlowDefinitionStatusActive},
		//					{ID: "flowdef_other_register", Status: domain.FlowDefinitionStatusActive},
		//				}, nil)
		//
		//			repo.EXPECT().
		//				UpdateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
		//				Times(1).
		//				Return(nil)
		//
		//			return repo
		//		},
		//	},
		//	args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
		//		FlowDefinitionID: "flowdef_123",
		//		ProjectID:        "project1",
		//		Name:             "login-register",
		//		Status:           "draft",
		//		SchemaVersion:    "1.0.0",
		//		UserSchema:       "https://tenant.com/schemas/my-user.json",
		//		Purposes: map[string]string{
		//			"login":    "step_1",
		//			"register": "step_1",
		//		},
		//		Steps: []domain.FlowDefinitionStep{{Name: "step_1"}},
		//	}},
		//	want: &domain.FlowDefinition{
		//		ID:            "flowdef_123",
		//		ProjectID:     "project1",
		//		Name:          "login-register",
		//		SchemaVersion: "1.0.0",
		//		Status:        domain.FlowDefinitionStatusDraft,
		//		UserSchema:    "https://tenant.com/schemas/my-user.json",
		//		Purposes: map[domain.FlowDefinitionPurpose]string{
		//			domain.FlowDefinitionPurposeLogin:    "step_1",
		//			domain.FlowDefinitionPurposeRegister: "step_1",
		//		},
		//	},
		//},
		{
			name: "active update removing purpose fails - removed purpose has no alternate active definition",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{
							ID:        "flowdef_123",
							ProjectID: "project1",
							Status:    domain.FlowDefinitionStatusActive,
							Purposes: map[domain.FlowDefinitionPurpose]string{
								domain.FlowDefinitionPurposeLogin:    "step_1",
								domain.FlowDefinitionPurposeRecovery: "step_1",
							},
						}, nil)
					// only self remains active for removed "recovery" purpose
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any(), gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{
							{ID: "flowdef_123", Status: domain.FlowDefinitionStatusActive},
						}, nil)
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_123",
				ProjectID:        "project1",
				Name:             "login-only",
				Status:           "active",
				SchemaVersion:    "1.0.0",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes: map[string]string{
					"login": "step_1", // remove recovery while active
				},
				Steps: []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			wantErr: domain.ErrFlowDefinitionUpdateConflict("cannot update: no other active flow definition found with purpose \"recovery\""),
		},
		{
			name: "active update removing purpose succeeds - alternate active definition exists for removed purpose",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{
							ID:        "flowdef_123",
							ProjectID: "project1",
							Status:    domain.FlowDefinitionStatusActive,
							Purposes: map[domain.FlowDefinitionPurpose]string{
								domain.FlowDefinitionPurposeLogin:    "step_1",
								domain.FlowDefinitionPurposeRecovery: "step_1",
							},
						}, nil)
					repo.EXPECT().
						ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any(), gomock.Any()).
						Times(1).
						Return([]*domain.FlowDefinition{
							{ID: "flowdef_123", Status: domain.FlowDefinitionStatusActive},
							{ID: "flowdef_other_recovery", Status: domain.FlowDefinitionStatusActive},
						}, nil)
					repo.EXPECT().
						UpdateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(nil)
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_123",
				ProjectID:        "project1",
				Name:             "login-only",
				Status:           "active",
				SchemaVersion:    "1.0.0",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes: map[string]string{
					"login": "step_1", // remove recovery while active
				},
				Steps: []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			want: &domain.FlowDefinition{
				ID:            "flowdef_123",
				ProjectID:     "project1",
				Name:          "login-only",
				SchemaVersion: "1.0.0",
				Status:        domain.FlowDefinitionStatusActive,
				UserSchema:    "https://tenant.com/schemas/my-user.json",
				Purposes: map[domain.FlowDefinitionPurpose]string{
					domain.FlowDefinitionPurposeLogin: "step_1",
				},
			},
		},
		{
			name: "repo update error",
			fields: fields{
				db: stubPool(),
				schemaResolver: &mockSchemaGetter{getSchema: func(ctx context.Context, projectID, teamID, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				}},
				builtinSchemaProvider: &mockBuiltinSchemaProvider{},
				validatorFn: func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
					return nil, nil
				},
				flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
					repo.EXPECT().
						GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
						Times(1).
						Return(&domain.FlowDefinition{ID: "flowdef_123", ProjectID: "project1"}, nil)
					repo.EXPECT().
						UpdateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).
						Times(1).
						Return(assert.AnError)
					return repo
				},
			},
			args: args{ctx: context.Background(), req: service.FlowDefinitionRequest{
				FlowDefinitionID: "flowdef_123",
				ProjectID:        "project1",
				Name:             "login",
				Status:           "active",
				SchemaVersion:    "1.0.0",
				UserSchema:       "https://tenant.com/schemas/my-user.json",
				Purposes:         map[string]string{"login": "step_1"},
				Steps:            []domain.FlowDefinitionStep{{Name: "step_1"}},
			}},
			wantErr: assert.AnError,
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

			got, err := fd.Update(tt.args.ctx, tt.args.req)
			after := time.Now()
			if tt.wantErr != nil {
				assertErrorDetails(t, err, tt.wantErr)
				assert.Nil(t, got)
				return
			}

			assert.NoError(t, err)
			assertFlowDefinition(t, got, tt.want, before, after)
			assert.Equal(t, tt.want.ID, got.ID)
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
	if wantDomainErr.Parent != nil {
		assert.EqualError(t, gotErr.Parent, wantDomainErr.Parent.Error())
	}
}

func Test_flowDefinitionService_Get(t *testing.T) {
	tests := []struct {
		name               string
		projectID          string
		id                 string
		flowDefinitionRepo func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository
		want               *domain.FlowDefinition
		wantErr            error
	}{
		{
			name:      "missing project id",
			projectID: "",
			id:        "flowdef_123",
			wantErr:   domain.ErrMissingProjectID(),
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				return nil
			},
		},
		{
			name:      "missing flow definition id",
			projectID: "project1",
			id:        "",
			wantErr:   domain.ErrMissingFlowDefinitionID(),
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				return nil
			},
		},
		{
			name:      "flow definition found",
			projectID: "project1",
			id:        "flowdef_123",
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
				repo.EXPECT().
					GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
					Times(1).
					Return(&domain.FlowDefinition{
						ProjectID:     "project1",
						ID:            "flowdef_123",
						Name:          "login-flow",
						SchemaVersion: "1.0.0",
						Status:        domain.FlowDefinitionStatusActive,
						CreatedAt:     time.Time{},
						UpdatedAt:     time.Time{},
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
								Actions: []domain.FlowStepAction{
									{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
								},
							},
							{
								Name:     "step_2",
								Complete: new(domain.FlowStepCompleteRedirect),
							},
						},
					}, nil)
				return repo
			},
			want: &domain.FlowDefinition{
				ProjectID:     "project1",
				ID:            "flowdef_123",
				Name:          "login-flow",
				SchemaVersion: "1.0.0",
				Status:        domain.FlowDefinitionStatusActive,
				CreatedAt:     time.Time{},
				UpdatedAt:     time.Time{},
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
						Actions: []domain.FlowStepAction{
							{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true},
						},
					},
					{
						Name:     "step_2",
						Complete: new(domain.FlowStepCompleteRedirect),
					},
				},
			},
		},
		{
			name:      "flow definition not found",
			projectID: "project1",
			id:        "flowdef_890",
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
				repo.EXPECT().
					GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_890").
					Times(1).
					Return(nil, &database.NoRowFoundError{})
				return repo
			},
			wantErr: domain.ErrFlowDefinitionNotFound(),
		},
		{
			name:      "error fetching flow definition",
			projectID: "project1",
			id:        "flowdef_890",
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
				repo.EXPECT().
					GetFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_890").
					Times(1).
					Return(nil, assert.AnError)
				return repo
			},
			wantErr: assert.AnError,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userSchema := &domain.JSONSchema{
				Schema: tenantUserSchema,
			}
			schemaResolver := &mockSchemaGetter{
				getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				},
			}
			builtinSchemaProvider := &mockBuiltinSchemaProvider{
				latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
					return "https://example.com/schemas/flow-definition.json", nil
				},
			}
			validatorFn := func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
				return []domain.PivotingTarget{}, nil
			}

			ctrl := gomock.NewController(t)
			fd := service.NewFlowDefinitionService(
				stubPool(),
				schemaResolver,
				builtinSchemaProvider,
				validatorFn,
				tt.flowDefinitionRepo(ctrl),
			)
			got, err := fd.Get(context.Background(), tt.projectID, tt.id)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			assert.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func Test_flowDefinitionService_List(t *testing.T) {
	tests := []struct {
		name               string
		req                service.ListFlowDefinitionsRequest
		flowDefinitionRepo func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository
		want               []*domain.FlowDefinition
		wantErr            error
	}{
		{
			name:    "missing project id",
			req:     service.ListFlowDefinitionsRequest{},
			wantErr: domain.ErrMissingProjectID(),
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				return nil
			},
		},
		{
			name: "flow definitions found",
			req: service.ListFlowDefinitionsRequest{
				ProjectID: "project1",
				Purpose:   "login",
			},
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
				repo.EXPECT().
					ListFlowDefinitions(
						gomock.Any(),
						gomock.Any(),
						"project1",
						gomock.Any(), // todo: a custom matcher to verify the filter
					).
					Times(1).
					Return([]*domain.FlowDefinition{
						{
							ProjectID: "project1",
							ID:        "flowdef_123",
							Name:      "login-flow-1",
						},
						{
							ProjectID: "project1",
							ID:        "flowdef_456",
							Name:      "login-flow-2",
						},
					}, nil)
				return repo
			},
			want: []*domain.FlowDefinition{
				{
					ProjectID: "project1",
					ID:        "flowdef_123",
					Name:      "login-flow-1",
				},
				{
					ProjectID: "project1",
					ID:        "flowdef_456",
					Name:      "login-flow-2",
				},
			},
		},
		{
			name: "error fetching flow definitions",
			req:  service.ListFlowDefinitionsRequest{ProjectID: "project1"},
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
				repo.EXPECT().
					ListFlowDefinitions(gomock.Any(), gomock.Any(), "project1", gomock.Any()).
					Times(1).
					Return(nil, assert.AnError)
				return repo
			},
			wantErr: assert.AnError,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userSchema := &domain.JSONSchema{
				Schema: tenantUserSchema,
			}
			schemaResolver := &mockSchemaGetter{
				getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				},
			}
			builtinSchemaProvider := &mockBuiltinSchemaProvider{
				latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
					return "https://example.com/schemas/flow-definition.json", nil
				},
			}
			validatorFn := func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
				return []domain.PivotingTarget{}, nil
			}

			ctrl := gomock.NewController(t)
			fd := service.NewFlowDefinitionService(
				stubPool(),
				schemaResolver,
				builtinSchemaProvider,
				validatorFn,
				tt.flowDefinitionRepo(ctrl),
			)
			got, err := fd.List(context.Background(), tt.req)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			assert.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestFlowDefinitionService_Delete(t *testing.T) {
	tests := []struct {
		name               string
		projectID          string
		flowDefinitionID   string
		flowDefinitionRepo func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository
		wantErr            error
	}{
		{
			name:             "missing project id",
			projectID:        "",
			flowDefinitionID: "flowdef_123",
			wantErr:          domain.ErrMissingProjectID(),
		},
		{
			name:             "missing flow definition id",
			projectID:        "project1",
			flowDefinitionID: "",
			wantErr:          domain.ErrMissingFlowDefinitionID(),
		},
		{
			name:             "flow definition deleted",
			projectID:        "project1",
			flowDefinitionID: "flowdef_123",
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
				repo.EXPECT().
					DeleteFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
					Times(1).
					Return(nil)
				return repo
			},
		},
		{
			name:             "error deleting flow definition",
			projectID:        "project1",
			flowDefinitionID: "flowdef_123",
			flowDefinitionRepo: func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
				repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
				repo.EXPECT().
					DeleteFlowDefinition(gomock.Any(), gomock.Any(), "project1", "flowdef_123").
					Times(1).
					Return(assert.AnError)
				return repo
			},
			wantErr: assert.AnError,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userSchema := &domain.JSONSchema{
				Schema: tenantUserSchema,
			}
			schemaResolver := &mockSchemaGetter{
				getSchema: func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
					return userSchema, nil
				},
			}
			builtinSchemaProvider := &mockBuiltinSchemaProvider{
				latestSchemaURIFunc: func(kind domain.KnownSchemaKind) (string, error) {
					return "https://example.com/schemas/flow-definition.json", nil
				},
			}
			validatorFn := func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error) {
				return []domain.PivotingTarget{}, nil
			}
			if tt.flowDefinitionRepo == nil {
				tt.flowDefinitionRepo = func(ctrl *gomock.Controller) *domainmock.MockFlowDefinitionRepository {
					return nil
				}
			}

			ctrl := gomock.NewController(t)
			fd := service.NewFlowDefinitionService(
				stubPool(),
				schemaResolver,
				builtinSchemaProvider,
				validatorFn,
				tt.flowDefinitionRepo(ctrl),
			)
			err := fd.Delete(context.Background(), tt.projectID, tt.flowDefinitionID)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			assert.NoError(t, err)
		})
	}
}
