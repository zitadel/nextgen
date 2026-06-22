package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

// stubPool returns nil typed as database.Pool. The flow definition service
// receives a pool but never calls into it under these mock-based tests;
// the helper exists to keep call sites readable. Mirrors the helper in
// the internal-package test file (flow_test.go) that this external-package
// test cannot reach.
func stubPool() database.Pool { return nil }

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
				db: nil,
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
						Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
					},
				},
			},
		},
		{
			name: "flow definition created successfully - target with an existing external flow",
			fields: fields{
				db: nil,
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
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
				db: nil,
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
				db: nil,
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
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
			wantFlowSchemaURI: "https://example.com/schemas/flow-definition.json",
			wantErr:           domain.ErrFlowDefinitionInvalid(`step "step_1": transition "next" targets unknown or inactive flow "external-flow"`, nil),
		},
		{
			name: "failed to create flow definition - validation failed",
			fields: fields{
				db: nil,
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
							Actions: []domain.FlowStepAction{
								{Name: "submit", Kind: domain.FlowActionKindSubmit},

								{Name: "next", Kind: domain.FlowActionKindSubmit},
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
			wantErr: domain.ErrFlowDefinitionInvalid("validation failed", assert.AnError),
		},
		{
			name: "failed to create flow definition - db error while creating",
			fields: fields{
				db: nil,
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
			wantErr: assert.AnError,
		},
		{
			name: "failed to create flow definition - db error while listing flow definitions",
			fields: fields{
				db: nil,
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
			wantErr: assert.AnError,
		},
		{
			name: "flow definition already exists",
			fields: fields{
				db: nil,
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
			wantErr: domain.ErrFlowDefinitionAlreadyExists(),
		},
		{
			name: "failed to get user schema",
			fields: fields{
				db: nil,
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
								Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
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
						Complete: gu.Ptr(domain.FlowStepCompleteRedirect),
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
				nil,
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
				nil,
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
				nil,
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
