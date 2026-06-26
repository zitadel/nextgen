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
	handler      *service.FlowCreateUserForPasskeyHandler
	userRepo     *domainmock.MockUserRepository
	schemaRepo   *domainmock.MockJSONSchemaRepository
	pool         *dbmock.MockPool
	tx           *dbmock.MockTransaction
	passwordRepo *domainmock.MockUserPasswordRepository
}

func newPasskeyHandlerFixture(t *testing.T) *passkeyHandlerFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	userRepo := domainmock.NewMockUserRepository(ctrl)
	passwordRepo := domainmock.NewMockUserPasswordRepository(ctrl)
	schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
	pool := dbmock.NewMockPool(ctrl)
	tx := dbmock.NewMockTransaction(ctrl)

	userService := service.NewUserService(pool, userRepo, passwordRepo, schemaRepo, nil, nil)
	handler := service.NewFlowCreateUserForPasskeyHandler(userRepo, userService, schemaRepo)

	return &passkeyHandlerFixture{
		handler:      handler,
		userRepo:     userRepo,
		schemaRepo:   schemaRepo,
		pool:         pool,
		tx:           tx,
		passwordRepo: passwordRepo,
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
	f.pool.EXPECT().Begin(gomock.Any(), gomock.Any()).Return(f.tx, nil)
	f.tx.EXPECT().Commit(gomock.Any()).Return(nil)

	var captured *domain.CreateUser
	f.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, u *domain.CreateUser) error {
			captured = u
			return nil
		})

	state := passkeyFlowState(map[string]any{
		"email":     "alice@example.com",
		"givenName": "Alice",
	})

	err := f.handler.CreateProvisionalUser(t.Context(),"user_provisional", state, domain.FlowResolvedFields{})
	require.NoError(t, err)
	require.NotNil(t, captured)
	assert.Equal(t, "user_provisional", captured.ID, "pre-assigned id must reach the user repository unchanged")
	assert.Equal(t, "https://example.test/schema.json", captured.SchemaURL)
}

func TestFlowCreateUserForPasskey_PersistsAllCollectedSchemaFields(t *testing.T) {
	f := newPasskeyHandlerFixture(t)
	expectSchemaLookup(f)
	f.pool.EXPECT().Begin(gomock.Any(), gomock.Any()).Return(f.tx, nil)
	f.tx.EXPECT().Commit(gomock.Any()).Return(nil)

	var captured *domain.CreateUser
	f.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, u *domain.CreateUser) error {
			captured = u
			return nil
		})

	state := passkeyFlowState(map[string]any{
		"email":      "alice@example.com",
		"givenName":  "Alice",
		"familyName": "Doe",
	})

	err := f.handler.CreateProvisionalUser(t.Context(),"user_1", state, domain.FlowResolvedFields{})
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
	f.pool.EXPECT().Begin(gomock.Any(), gomock.Any()).Return(f.tx, nil)
	f.tx.EXPECT().Rollback(gomock.Any()).Return(nil)
	f.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.UniqueError{})

	state := passkeyFlowState(map[string]any{"email": "alice@example.com"})

	err := f.handler.CreateProvisionalUser(t.Context(),"user_1", state, domain.FlowResolvedFields{})
	assert.NoError(t, err, "racing prior on_success must not surface as an error")
}

func TestFlowCreateUserForPasskey_OtherErrorsPropagate(t *testing.T) {
	f := newPasskeyHandlerFixture(t)
	expectSchemaLookup(f)
	f.pool.EXPECT().Begin(gomock.Any(), gomock.Any()).Return(f.tx, nil)
	f.tx.EXPECT().Rollback(gomock.Any()).Return(nil)
	sentinel := errors.New("repo exploded")
	f.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(sentinel)

	state := passkeyFlowState(map[string]any{"email": "alice@example.com"})

	err := f.handler.CreateProvisionalUser(t.Context(),"user_1", state, domain.FlowResolvedFields{})
	require.Error(t, err)
}
