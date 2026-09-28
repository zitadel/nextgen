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
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Provider: "google", Email: "a@b.test"},
		},
		"empty email": {
			ProjectID:        "proj-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Provider: "google", Subject: "sub-1"},
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

// A verified callback creates the user with no password and records the user
// factor on the attempt in the same transaction, so the session exchanged at
// the end of the flow is bound to a user that has one.
func TestFlowCreateUserWithSso_RecordsTheUserFactor(t *testing.T) {
	f := newSsoHandlerFixture(t)

	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_sso0001", nil)
	f.schemaStore.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{
			ProjectID: "proj_1",
			URL:       "https://example.test/schema.json",
			Schema:    []byte(passwordHandlerTestSchema),
		}, nil).AnyTimes()

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
		Times(1)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	f.v2Pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{stmts: f.stmts})
		})

	out, err := f.handler.Handle(t.Context(), domain.FlowOnSuccessInput{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		// The flow resolves email as the identifier, so the verified address
		// lands there rather than whatever the form carried.
		Resolved: domain.FlowResolvedFields{Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier},
		}},
		State: &domain.FlowState{
			ProjectID:        "proj_1",
			AuthAttemptID:    "att-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Provider: "google", Subject: "sub-123", Email: "alice@example.com"},
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

	// Only the user factor: what the provider asserted lives on the
	// sso_callback record (#1073), not on a factor of its own.
	require.Len(t, recordedFactors, 1)
	userFactor, ok := recordedFactors[0].(*domain.AuthFactorUser)
	require.True(t, ok, "the recorded factor must be the user factor")
	assert.Equal(t, "user_sso0001", userFactor.UserID)
}

// When the provider's email already has an account, the create loses the unique
// race and the handler must route the user_already_exists outcome (to the
// conflict step) rather than re-rendering the step with an error -- the user
// cannot change the address the provider gave.
func TestFlowCreateUserWithSso_RoutesUserAlreadyExistsOnCollision(t *testing.T) {
	f := newSsoHandlerFixture(t)

	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_sso0002", nil)
	f.schemaStore.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{
			ProjectID: "proj_1",
			URL:       "https://example.test/schema.json",
			Schema:    []byte(passwordHandlerTestSchema),
		}, nil).AnyTimes()
	// The DB reports the unique-constraint violation; applyCreateUser
	// translates it to ErrUserAlreadyExists, which the handler routes.
	f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).
		Return(database.NewUniqueError("users", "users_email_key", nil))
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	f.v2Pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{stmts: f.stmts})
		})

	out, err := f.handler.Handle(t.Context(), domain.FlowOnSuccessInput{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		// The flow resolves email as the identifier, so the verified address
		// lands there rather than whatever the form carried.
		Resolved: domain.FlowResolvedFields{Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier},
		}},
		State: &domain.FlowState{
			ProjectID:        "proj_1",
			AuthAttemptID:    "att-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Provider: "google", Subject: "sub-123", Email: "alice@example.com"},
			FlowProgress: domain.FlowProgress{
				CollectedData: domain.CollectedFlowData{
					UserData: map[string]any{"email": "alice@example.com"},
				},
			},
		},
	})
	require.NoError(t, err)
	require.Nil(t, out.StepError, "a collision must route an outcome, not re-render a step error")
	assert.Equal(t, domain.FlowImplicitOutcomeUserAlreadyExists, out.Outcome)
	assert.Empty(t, out.UserID, "no user is created on a collision")
}

// The provider's address is the one the account is created from. A submit that
// merges a different email over the callback's prefilled value must not win --
// otherwise a genuine callback for one address mints an account for another.
func TestFlowCreateUserWithSso_IgnoresSubmittedEmailInFavourOfVerified(t *testing.T) {
	f := newSsoHandlerFixture(t)

	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_sso0003", nil)
	f.schemaStore.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{
			ProjectID: "proj_1",
			URL:       "https://example.test/schema.json",
			Schema:    []byte(passwordHandlerTestSchema),
		}, nil).AnyTimes()

	var created *domain.CreateUser
	f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, u *domain.CreateUser) error {
			created = u
			return nil
		})
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj_1", "att-1").
		Return(&domain.AuthAttempt{ProjectID: "proj_1", ID: "att-1"}, nil)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), "proj_1", "att-1", gomock.Any()).
		Return("ch-1", nil).AnyTimes()
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	f.v2Pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{stmts: f.stmts})
		})

	_, err := f.handler.Handle(t.Context(), domain.FlowOnSuccessInput{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		Resolved: domain.FlowResolvedFields{Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier},
		}},
		State: &domain.FlowState{
			ProjectID:     "proj_1",
			AuthAttemptID: "att-1",
			// The provider vouched for alice.
			VerifiedIdentity: &domain.FlowVerifiedIdentity{
				Provider: "google", Subject: "sub-123", Email: "alice@example.com",
			},
			FlowProgress: domain.FlowProgress{
				CollectedData: domain.CollectedFlowData{
					// ...but the submit carried someone else's address.
					UserData: map[string]any{"email": "attacker@evil.test"},
				},
			},
		},
	})
	require.NoError(t, err)

	require.NotNil(t, created)
	email, ok := created.Attributes.Get("email")
	require.True(t, ok, "the created user must carry an email attribute")
	assert.Equal(t, "alice@example.com", email.Value,
		"the account must be created from the provider-verified address, not the submitted one")
}
