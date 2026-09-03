package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
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

type mockSchemaGetter struct {
	getSchema func(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error)
}

func v2PoolFromStatements(t *testing.T, stmts service.AllStatements) *service.DB {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(stmts).AnyTimes()
	if mock, ok := stmts.(*servicemocks.MockAllStatements); ok {
		mock.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	}
	return service.NewPool(pool)
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
		schemaResolver        service.SchemaGetter
		builtinSchemaProvider service.BuiltinSchemaProvider
		validatorFn           func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error)
		statements            func(ctrl *gomock.Controller) *servicemocks.MockAllStatements
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
				statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
					stmts := servicemocks.NewMockAllStatements(ctrl)
					stmts.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, fd *domain.FlowDefinition) error {
						fd.ID = "flowdef_test01"
						return nil
					}).Times(1)
					return stmts
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
				statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
					stmts := servicemocks.NewMockAllStatements(ctrl)
					stmts.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, fd *domain.FlowDefinition) error {
						fd.ID = "flowdef_test01"
						return nil
					}).Times(1)
					stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).Return(
						&database.ListResult[*domain.FlowDefinition]{Items: []*domain.FlowDefinition{
							{
								Name:   "external-flow",
								Status: domain.FlowDefinitionStatusActive,
							},
						}}, nil,
					).Times(1)
					return stmts
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
							Fields: []domain.Field{"email"},
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
						Fields: []domain.Field{"email"},
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
				statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
					stmts := servicemocks.NewMockAllStatements(ctrl)
					stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
						return &database.ListResult[*domain.FlowDefinition]{Items: []*domain.FlowDefinition{}}, nil
					}).Times(1)
					return stmts
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
							Fields: []domain.Field{"email"},
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
				statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
					stmts := servicemocks.NewMockAllStatements(ctrl)
					return stmts
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
							Fields: []domain.Field{"email"},
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
				statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
					stmts := servicemocks.NewMockAllStatements(ctrl)
					stmts.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, *domain.FlowDefinition) error {
						return assert.AnError
					}).Times(1)
					return stmts
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
							Complete: new(domain.FlowStepCompleteRedirect),
						},
					},
				},
			},
			wantErr: assert.AnError,
		},
		{
			name: "failed to get user schema",
			fields: fields{
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
				statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
					stmts := servicemocks.NewMockAllStatements(ctrl)
					return stmts
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
			stmts := servicemocks.NewMockAllStatements(ctrl)
			if tt.fields.statements != nil {
				stmts = tt.fields.statements(ctrl)
			}
			fd := service.NewFlowDefinitionService(
				v2PoolFromStatements(t, stmts),
				tt.fields.schemaResolver,
				tt.fields.builtinSchemaProvider,
				tt.fields.validatorFn,
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
		name       string
		projectID  string
		id         string
		statements func(ctrl *gomock.Controller) *servicemocks.MockAllStatements
		want       *domain.FlowDefinition
		wantErr    error
	}{
		{
			name:      "missing project id",
			projectID: "",
			id:        "flowdef_123",
			wantErr:   domain.ErrMissingProjectID(),
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				return servicemocks.NewMockAllStatements(ctrl)
			},
		},
		{
			name:      "missing flow definition id",
			projectID: "project1",
			id:        "",
			wantErr:   domain.ErrMissingFlowDefinitionID(),
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				return servicemocks.NewMockAllStatements(ctrl)
			},
		},
		{
			name:      "flow definition found",
			projectID: "project1",
			id:        "flowdef_123",
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				stmts := servicemocks.NewMockAllStatements(ctrl)
				stmts.EXPECT().GetFlowDefinitionByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.FlowDefinition, error) {
					return &domain.FlowDefinition{
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
								Complete: new(domain.FlowStepCompleteRedirect),
							},
						},
					}, nil
				}).Times(1)
				return stmts
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
						Complete: new(domain.FlowStepCompleteRedirect),
					},
				},
			},
		},
		{
			name:      "flow definition not found",
			projectID: "project1",
			id:        "flowdef_890",
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				stmts := servicemocks.NewMockAllStatements(ctrl)
				stmts.EXPECT().GetFlowDefinitionByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.FlowDefinition, error) {
					return nil, &database.NoRowFoundError{}
				}).Times(1)
				return stmts
			},
			wantErr: domain.ErrFlowDefinitionNotFound(),
		},
		{
			name:      "error fetching flow definition",
			projectID: "project1",
			id:        "flowdef_890",
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				stmts := servicemocks.NewMockAllStatements(ctrl)
				stmts.EXPECT().GetFlowDefinitionByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.FlowDefinition, error) {
					return nil, assert.AnError
				}).Times(1)
				return stmts
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
			stmts := servicemocks.NewMockAllStatements(ctrl)
			if tt.statements != nil {
				stmts = tt.statements(ctrl)
			}
			fd := service.NewFlowDefinitionService(
				v2PoolFromStatements(t, stmts),
				schemaResolver,
				builtinSchemaProvider,
				validatorFn,
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
		name       string
		req        service.ListFlowDefinitionsRequest
		statements func(ctrl *gomock.Controller) *servicemocks.MockAllStatements
		want       *service.ListFlowDefinitionsResponse
		wantErr    error
	}{
		{
			name:    "missing project id",
			req:     service.ListFlowDefinitionsRequest{},
			wantErr: domain.ErrMissingProjectID(),
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				return servicemocks.NewMockAllStatements(ctrl)
			},
		},
		{
			name: "flow definitions found",
			req: service.ListFlowDefinitionsRequest{
				ProjectID: "project1",
				Purpose:   "login",
			},
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				stmts := servicemocks.NewMockAllStatements(ctrl)
				stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).Return(
					&database.ListResult[*domain.FlowDefinition]{
						Items: []*domain.FlowDefinition{
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
						NextCursor: []byte("next-page"),
					}, nil,
				).Times(1)
				return stmts
			},
			want: &service.ListFlowDefinitionsResponse{
				Items: []*domain.FlowDefinition{
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
				NextPageToken: "next-page",
			},
		},
		{
			name: "name filter narrows the list to one flow's revisions",
			req: service.ListFlowDefinitionsRequest{
				ProjectID: "project1",
				Name:      "login-flow",
			},
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				stmts := servicemocks.NewMockAllStatements(ctrl)
				stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, opts *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
						assert.Equal(t, database.And(
							database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), "project1"),
							database.Equal(database.Col(domain.FlowDefinitionFieldName), "login-flow"),
						), opts.Filter)
						return &database.ListResult[*domain.FlowDefinition]{}, nil
					},
				).Times(1)
				return stmts
			},
			want: &service.ListFlowDefinitionsResponse{},
		},
		{
			name: "error fetching flow definitions",
			req:  service.ListFlowDefinitionsRequest{ProjectID: "project1"},
			statements: func(ctrl *gomock.Controller) *servicemocks.MockAllStatements {
				stmts := servicemocks.NewMockAllStatements(ctrl)
				stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).Return(
					(*database.ListResult[*domain.FlowDefinition])(nil), assert.AnError,
				).Times(1)
				return stmts
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
			stmts := servicemocks.NewMockAllStatements(ctrl)
			if tt.statements != nil {
				stmts = tt.statements(ctrl)
			}
			fd := service.NewFlowDefinitionService(
				v2PoolFromStatements(t, stmts),
				schemaResolver,
				builtinSchemaProvider,
				validatorFn,
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

func Test_flowDefinitionService_List_limit(t *testing.T) {
	tests := []struct {
		name      string
		limit     int
		wantLimit uint32
	}{
		{name: "omitted limit uses the default, not storage's no-limit", limit: 0, wantLimit: 20},
		{name: "negative limit uses the default", limit: -5, wantLimit: 20},
		{name: "limit is clamped to the maximum", limit: 500, wantLimit: 100},
		{name: "limit within range is passed through", limit: 25, wantLimit: 25},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, opts *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
					assert.Equal(t, tt.wantLimit, opts.Pagination.Limit)
					return &database.ListResult[*domain.FlowDefinition]{}, nil
				},
			).Times(1)

			fd := service.NewFlowDefinitionService(
				v2PoolFromStatements(t, stmts),
				&mockSchemaGetter{},
				&mockBuiltinSchemaProvider{},
				nil,
			)
			_, err := fd.List(context.Background(), service.ListFlowDefinitionsRequest{
				ProjectID: "project1",
				Limit:     tt.limit,
			})
			assert.NoError(t, err)
		})
	}
}
