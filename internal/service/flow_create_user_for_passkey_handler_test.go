package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbmock"
	"go.uber.org/mock/gomock"
)

const passkeyHandlerTestSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"$id": "https://example.test/schema.json",
	"type": "object",
	"required": ["email"],
	"properties": {
		"email": {"type": "string", "format": "email", "x-unique": "project"},
		"givenName": {"type": "string"},
		"familyName": {"type": "string"}
	}
}`

type passkeyHandlerFixture struct {
	handler    *service.FlowCreateUserForPasskeyHandler
	schemaRepo *domainmock.MockJSONSchemaRepository
	pool       *dbmock.MockPool
	v2Pool     *servicemocks.MockPool
	stmts      *servicemocks.MockAllStatements
}

func newPasskeyHandlerFixture(t *testing.T) *passkeyHandlerFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
	pool := dbmock.NewMockPool(ctrl)
	v2Pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)

	userService := service.NewUserService(pool, service.NewPool(v2Pool), schemaRepo, nil)
	handler := service.NewFlowCreateUserForPasskeyHandler(userService, schemaRepo)

	return &passkeyHandlerFixture{
		handler:    handler,
		schemaRepo: schemaRepo,
		pool:       pool,
		v2Pool:     v2Pool,
		stmts:      stmts,
	}
}

func passkeyFlowState(collected map[string]any) *domain.FlowState {
	return &domain.FlowState{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		FlowProgress: domain.FlowProgress{
			CollectedData: domain.CollectedFlowData{
				UserData: collected,
			},
		},
	}
}

func expectSchemaLookup(f *passkeyHandlerFixture) {
	f.schemaRepo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{
			ProjectID: "proj_1",
			URL:       "https://example.test/schema.json",
			Schema:    []byte(passkeyHandlerTestSchema),
		}, nil)
}

func expectCreateUserTx(f *passkeyHandlerFixture, createFn func(context.Context, *domain.CreateUser) error) {
	f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).DoAndReturn(createFn)
	f.v2Pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{QueryExecutor: f.pool, stmts: f.stmts})
		})
}

func attributeByKey(t *testing.T, attrs []*domain.CreateAttribute, key string) *domain.CreateAttribute {
	t.Helper()
	for _, a := range attrs {
		if a.Key == key {
			return a
		}
	}
	t.Fatalf("attribute %q not present in %d attributes", key, len(attrs))
	return nil
}

func TestFlowCreateUserForPasskey_HonorsPreAssignedUserID(t *testing.T) {
	f := newPasskeyHandlerFixture(t)
	expectSchemaLookup(f)

	var captured *domain.CreateUser
	expectCreateUserTx(f, func(_ context.Context, u *domain.CreateUser) error {
		captured = u
		return nil
	})

	state := passkeyFlowState(map[string]any{
		"email":     "alice@example.com",
		"givenName": "Alice",
	})

	err := f.handler.CreateProvisionalUser(t.Context(), "user_provisional", state)
	require.NoError(t, err)
	require.NotNil(t, captured)
	assert.Equal(t, "user_provisional", captured.ID, "pre-assigned id must reach CreateUser unchanged")
	assert.Equal(t, "https://example.test/schema.json", captured.SchemaURL)
}

func TestFlowCreateUserForPasskey_PersistsAllCollectedSchemaFields(t *testing.T) {
	f := newPasskeyHandlerFixture(t)
	expectSchemaLookup(f)

	var captured *domain.CreateUser
	expectCreateUserTx(f, func(_ context.Context, u *domain.CreateUser) error {
		captured = u
		return nil
	})

	state := passkeyFlowState(map[string]any{
		"email":      "alice@example.com",
		"givenName":  "Alice",
		"familyName": "Doe",
	})

	err := f.handler.CreateProvisionalUser(t.Context(), "user_1", state)
	require.NoError(t, err)
	require.NotNil(t, captured)

	emailAttr := attributeByKey(t, captured.Attributes, "email")
	assert.Equal(t, "alice@example.com", emailAttr.Value)
	assert.Equal(t, domain.AttributeUniquenessProject, emailAttr.UniqueScope, "x-unique on the schema must carry through")

	givenAttr := attributeByKey(t, captured.Attributes, "givenName")
	assert.Equal(t, "Alice", givenAttr.Value)

	familyAttr := attributeByKey(t, captured.Attributes, "familyName")
	assert.Equal(t, "Doe", familyAttr.Value)
}

func TestFlowCreateUserForPasskey_UserAlreadyExistsIsSilent(t *testing.T) {
	f := newPasskeyHandlerFixture(t)
	expectSchemaLookup(f)
	expectCreateUserTx(f, func(context.Context, *domain.CreateUser) error {
		return &database.UniqueError{}
	})

	state := passkeyFlowState(map[string]any{"email": "alice@example.com"})

	err := f.handler.CreateProvisionalUser(t.Context(), "user_1", state)
	assert.NoError(t, err, "racing prior on_success must not surface as an error")
}

func TestFlowCreateUserForPasskey_OtherErrorsPropagate(t *testing.T) {
	f := newPasskeyHandlerFixture(t)
	expectSchemaLookup(f)
	sentinel := errors.New("repo exploded")
	expectCreateUserTx(f, func(context.Context, *domain.CreateUser) error {
		return sentinel
	})

	state := passkeyFlowState(map[string]any{"email": "alice@example.com"})

	err := f.handler.CreateProvisionalUser(t.Context(), "user_1", state)
	require.Error(t, err)
}
