package service_test

import (
	"context"
	"errors"
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

// create_user_with_sso mints a user with no password, so it must only run when
// a provider callback verified an identity. Without the guard, a flow author
// could route a plain submit into it and create an account with no proof of
// identity (raised in review by @vitorbari). These cases pin that the guard
// refuses before touching any storage, so nil dependencies are fine here.
func TestFlowCreateUserWithSso_RefusesWithoutVerifiedIdentity(t *testing.T) {
	t.Parallel()
	handler := service.NewFlowCreateUserWithSsoHandler(nil, nil, nil)

	cases := map[string]*domain.FlowState{
		"nil verified identity": {ProjectID: "proj-1"},
		"empty provider": {
			ProjectID:        "proj-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Subject: "sub-1"},
		},
		"empty subject": {
			ProjectID:        "proj-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Provider: "google"},
		},
	}

	for name, state := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := handler.Handle(t.Context(), domain.FlowOnSuccessInput{
				ProjectID: state.ProjectID,
				State:     state,
			})
			require.Error(t, err)
			require.True(t, errors.Is(err, domain.ErrFlowIntegrity()),
				"create_user_with_sso without a verified identity must be a flow-integrity error, got: %v", err)
		})
	}
}

type ssoHandlerFixture struct {
	handler     *service.FlowCreateUserWithSsoHandler
	schemaStore *domainmock.MockJSONSchemaStore
	v2Pool      *servicemocks.MockPool
	stmts       *servicemocks.MockAllStatements
}

func newSsoHandlerFixture(t *testing.T) *ssoHandlerFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	v2Pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	// The SSO handler sets no password, so the hasher is never called; it is
	// only needed to construct the user service.
	hasher := cryptomock.NewMockHasher(ctrl)

	v2Pool.EXPECT().Statements().Return(stmts).AnyTimes()
	svcPool := service.NewPool(v2Pool)
	stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.JSONSchema]{}, nil).AnyTimes()
	userService := service.NewUserService(svcPool, schemaStore, service.FixedProjectHasherResolver{Hasher: hasher}, service.StatementsUserRefResolver{Pool: svcPool})
	handler := service.NewFlowCreateUserWithSsoHandler(userService, schemaStore, v2Pool)

	return &ssoHandlerFixture{
		handler:     handler,
		schemaStore: schemaStore,
		v2Pool:      v2Pool,
		stmts:       stmts,
	}
}

// A verified callback creates the user with no password and records two factors
// on the attempt in the same transaction: the user factor binds the session,
// and the SSO factor captures which provider vouched and for whom. Mirrors the
// symmetric factor recording in TestFlowCreateUserWithPassword_PreMintsSharedUserID.
func TestFlowCreateUserWithSso_RecordsUserAndSsoFactors(t *testing.T) {
	f := newSsoHandlerFixture(t)

	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_sso0001", nil)
	f.schemaStore.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{
			ProjectID: "proj_1",
			URL:       "https://example.test/schema.json",
			Schema:    []byte(passwordHandlerTestSchema),
		}, nil)

	var created *domain.CreateUser
	f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, u *domain.CreateUser) error {
			created = u
			return nil
		})
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
			ProjectID:        "proj_1",
			AuthAttemptID:    "att-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Provider: "google", Subject: "sub-123"},
			FlowProgress: domain.FlowProgress{
				CollectedData: domain.CollectedFlowData{
					UserData: map[string]any{"email": "alice@example.com"},
				},
			},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "user_sso0001", out.UserID)
	require.NotNil(t, created)
	assert.Equal(t, "user_sso0001", created.ID)

	require.Len(t, recordedFactors, 2)
	userFactor, ok := recordedFactors[0].(*domain.AuthFactorUser)
	require.True(t, ok, "first recorded factor must be the user factor")
	assert.Equal(t, "user_sso0001", userFactor.UserID)
	ssoFactor, ok := recordedFactors[1].(*domain.AuthFactorSso)
	require.True(t, ok, "second recorded factor must be the sso factor")
	assert.Equal(t, "google", ssoFactor.Provider)
	assert.Equal(t, "sub-123", ssoFactor.Subject)
}
