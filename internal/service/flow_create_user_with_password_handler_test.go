package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

type passwordHandlerFixture struct {
	handler     *service.FlowCreateUserWithPasswordHandler
	schemaStore *domainmock.MockJSONSchemaStore
	v2Pool      *servicemocks.MockPool
	stmts       *servicemocks.MockAllStatements
	hasher      *cryptomock.MockHasher
}

func newPasswordHandlerFixture(t *testing.T) *passwordHandlerFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	v2Pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	hasher := cryptomock.NewMockHasher(ctrl)

	v2Pool.EXPECT().Statements().Return(stmts).AnyTimes()
	userService := service.NewUserService(service.NewPool(v2Pool), schemaStore, hasher)
	handler := service.NewFlowCreateUserHandler(hasher, userService, schemaStore)

	return &passwordHandlerFixture{
		handler:     handler,
		schemaStore: schemaStore,
		v2Pool:      v2Pool,
		stmts:       stmts,
		hasher:      hasher,
	}
}

func TestFlowCreateUserWithPassword_PreMintsSharedUserID(t *testing.T) {
	f := newPasswordHandlerFixture(t)

	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_premint01", nil)
	f.schemaStore.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{
			ProjectID: "proj_1",
			URL:       "https://example.test/schema.json",
			Schema:    []byte(passkeyHandlerTestSchema),
		}, nil)
	f.hasher.EXPECT().Hash(gomock.Any()).DoAndReturn(func(password string) (string, error) {
		assert.Equal(t, "s3cret", password)
		return "hash-s3cret", nil
	})

	var created *domain.CreateUser
	var password *domain.SetUserPassword
	f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, u *domain.CreateUser) error {
			created = u
			return nil
		})
	f.stmts.EXPECT().SetUserPassword(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, pw *domain.SetUserPassword) error {
			password = pw
			return nil
		})
	f.v2Pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{stmts: f.stmts})
		})

	out, err := f.handler.Handle(t.Context(), domain.FlowOnSuccessInput{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		State: &domain.FlowState{
			ProjectID: "proj_1",
			FlowProgress: domain.FlowProgress{
				CollectedData: domain.CollectedFlowData{
					UserData: map[string]any{"email": "alice@example.com"},
					AuthMethods: domain.CollectedAuthMethodData{
						Password: "s3cret",
					},
				},
			},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "user_premint01", out.UserID)
	require.NotNil(t, created)
	require.NotNil(t, password)
	assert.Equal(t, "user_premint01", created.ID, "create and password must share the pre-minted id")
	assert.Equal(t, "user_premint01", password.UserID)
	assert.Equal(t, "hash-s3cret", password.EncodedHash)
}

func TestFlowCreateUserWithPassword_MissingPasswordIsIntegrityError(t *testing.T) {
	f := newPasswordHandlerFixture(t)

	_, err := f.handler.Handle(t.Context(), domain.FlowOnSuccessInput{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		State: &domain.FlowState{
			FlowProgress: domain.FlowProgress{
				CollectedData: domain.CollectedFlowData{
					UserData: map[string]any{"email": "alice@example.com"},
				},
			},
		},
	})
	require.ErrorIs(t, err, domain.ErrFlowIntegrity())
}
