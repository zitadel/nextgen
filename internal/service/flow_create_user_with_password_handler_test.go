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
	"github.com/zitadel/nextgen/internal/storage/database"
)

const passwordHandlerTestSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"$id": "https://example.test/schema.json",
	"type": "object",
	"properties": {
		"email": {"type": "string", "format": "email", "x-unique": "project"}
	}
}`

// v2TestTx satisfies Statementer for transaction closures in tests.
type v2TestTx struct {
	stmts *servicemocks.MockAllStatements
}

func (tx v2TestTx) Statements() service.AllStatements { return tx.stmts }

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
	svcPool := service.NewPool(v2Pool)
	stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.JSONSchema]{}, nil).AnyTimes()
	userService := service.NewUserService(svcPool, schemaStore, hasher, service.StatementsUserRefResolver{Pool: svcPool})
	handler := service.NewFlowCreateUserHandler(hasher, userService, schemaStore, v2Pool)

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
			Schema:    []byte(passwordHandlerTestSchema),
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
	// Symmetric factor recording: user + password land on the attempt in the
	// same transaction as the user mutation.
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj_1", "att-1").
		Return(&domain.AuthAttempt{ProjectID: "proj_1", ID: "att-1"}, nil)
	var recordedFactors []domain.AuthFactor
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), "proj_1", "att-1", gomock.Any()).
		DoAndReturn(func(_ context.Context, _, _ string, factor domain.AuthFactor) (string, error) {
			recordedFactors = append(recordedFactors, factor)
			return "ch-" + factor.Type().String(), nil
		}).
		Times(2)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	f.v2Pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{stmts: f.stmts})
		})

	out, err := f.handler.Handle(t.Context(), domain.FlowOnSuccessInput{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		State: &domain.FlowState{
			ProjectID:     "proj_1",
			AuthAttemptID: "att-1",
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

	require.Len(t, recordedFactors, 2)
	userFactor, ok := recordedFactors[0].(*domain.AuthFactorUser)
	require.True(t, ok, "first recorded factor must be the user factor")
	assert.Equal(t, "user_premint01", userFactor.UserID)
	_, ok = recordedFactors[1].(*domain.AuthFactorPassword)
	require.True(t, ok, "second recorded factor must be the password factor")
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
