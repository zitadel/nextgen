package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen/idgenmock"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbmock"
	"go.uber.org/mock/gomock"
)

// defaultSchema covers email/username/password/given_name/family_name
// with the same shape as the embedded built-in. Inlining it keeps test
// setup self-contained.
const defaultSchemaURL = "https://example.test/user/v1/default.user.schema.json"
const testProjectID = "proj-1"

func defaultSchemaBytes() []byte {
	return []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"required": ["email", "username", "password", "given_name", "family_name"],
		"properties": {
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-unique": "team" },
			"username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-unique": "team" },
			"password":    { "type": "string", "minLength": 8, "x-password": true },
			"given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
			"family_name": { "type": "string", "minLength": 1, "maxLength": 200 }
		}
	}`)
}

const minimalUserSchema = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { 
			"passkey":  { "enabled": true },
			"password": { "enabled": true } 
		},
		"properties": {
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-unique": "team" },
			"password":    { "type": "string", "minLength": 8, "x-password": true }
		}
	}`

func minimalSchema(projectID string) *domain.JSONSchema {
	return &domain.JSONSchema{
		ProjectID: projectID,
		URL:       "schema-1",
		CreatedAt: time.Now().UTC(),
		Schema:    []byte(minimalUserSchema),
	}
}

func newDefaultResolver(t *testing.T) *domain.SchemaFieldResolver {
	t.Helper()
	return domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{
		defaultSchemaURL: defaultSchemaBytes(),
	}))
}

// fakeSchemaResolver feeds inline JSON bytes through a real
// [jsonschema.SchemaFromJSON] parser so tests exercise the same
// keyword extraction the production path uses, without needing a
// database or HTTP client.
type fakeSchemaResolver struct {
	bytesByURL map[string][]byte
}

func (f *fakeSchemaResolver) Resolve(_ context.Context, _ database.QueryExecutor, _, schemaURL string, _ []byte) (*jsonschema.Schema, error) {
	raw, ok := f.bytesByURL[schemaURL]
	if !ok {
		return nil, errors.New("fakeSchemaResolver: schema not found: " + schemaURL)
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return jsonschema.SchemaFromJSON("https://json-schema.org/draft/2020-12/schema", nil, v)
}

func newFakeResolver(t *testing.T, schemas map[string][]byte) domain.SchemaResolver {
	t.Helper()
	return &fakeSchemaResolver{bytesByURL: schemas}
}

func findAttribute(attrs []*domain.CreateAttribute, key string) *domain.CreateAttribute {
	for _, a := range attrs {
		if a.Key == key {
			return a
		}
	}
	return nil
}

func containsFieldName(fields []domain.FlowField, name string) bool {
	for _, f := range fields {
		if f.Name == name {
			return true
		}
	}
	return false
}

func findAction(actions []service.FlowAction, name string) (service.FlowAction, bool) {
	for _, a := range actions {
		if a.Name == name {
			return a, true
		}
	}
	return service.FlowAction{}, false
}

// flowTestWorld is the wiring a flow test exercises: resolver +
// registry + handlers + state machine, sharing the fakes the test
// inspects after a run.
type flowTestWorld struct {
	mock               *gomock.Controller
	userRepo           *domainmock.MockUserRepository
	passwordRepo       *domainmock.MockUserPasswordRepository
	ids                *idgenmock.MockGenerator
	hasher             *cryptomock.MockHasher
	authAttemptService *domainmock.MockFlowAuthAttemptService
	passkeyRegService  *domainmock.MockFlowPasskeyRegistrationService
	sm                 *service.FlowStateMachineRuntime
	schemaRepo         *domainmock.MockJSONSchemaRepository
	db                 *dbmock.MockPool
	transaction        *dbmock.MockTransaction
	tokenVerifier      *domainmock.MockTokenVerifier
}

func newFlowTestWorld(t *testing.T) *flowTestWorld {
	t.Helper()
	mock := gomock.NewController(t)

	dbPool := dbmock.NewMockPool(mock)
	userRepo := domainmock.NewMockUserRepository(mock)
	passwordRepo := domainmock.NewMockUserPasswordRepository(mock)
	schemaRepo := domainmock.NewMockJSONSchemaRepository(mock)
	authAttemptService := domainmock.NewMockFlowAuthAttemptService(mock)
	passkeyRegService := domainmock.NewMockFlowPasskeyRegistrationService(mock)
	transaction := dbmock.NewMockTransaction(mock)
	tokenVerifier := domainmock.NewMockTokenVerifier(mock)

	ids := idgenmock.NewMockGenerator(mock)
	ids.EXPECT().
		New(gomock.Any()).
		DoAndReturn(func(prefix string) (string, error) { return prefix + "_01TEST", nil }).
		AnyTimes()

	hasher := cryptomock.NewMockHasher(mock)
	hasher.EXPECT().
		Hash(gomock.Any()).
		DoAndReturn(func(s string) (string, error) { return "hashed:" + s, nil }).
		AnyTimes()

	userService := service.NewUserService(
		dbPool,
		userRepo,
		passwordRepo,
		schemaRepo,
		hasher,
		tokenVerifier,
	)

	// TODO make interface of FlowCreateUserHandler
	createUser := service.NewFlowCreateUserHandler(
		userRepo,
		passwordRepo,
		hasher,
		userService,
		schemaRepo,
	)
	resolver := newDefaultResolver(t)
	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }
	sm := service.NewFlowStateMachine(
		resolver,
		createUser,
		authAttemptService,
		passkeyRegService,
		userService,
		now,
	)

	return &flowTestWorld{
		mock:               mock,
		userRepo:           userRepo,
		passwordRepo:       passwordRepo,
		ids:                ids,
		hasher:             hasher,
		authAttemptService: authAttemptService,
		passkeyRegService:  passkeyRegService,
		sm:                 sm,
		schemaRepo:         schemaRepo,
		db:                 dbPool,
		transaction:        transaction,
		tokenVerifier:      tokenVerifier,
	}
}

// loginDefinition builds a single-step login flow: a `credentials`
// step with email (identifier) + password, no on_success, transitioning
// to the `done` terminal on `submit` and to `not_found` on
// `user_not_found`.
func loginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-login",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "credentials",
				Fields: []string{"email", "password"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit:               {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "not_found"},
				},
			},
			{
				Name:     "done",
				Complete: &show,
			},
			{
				Name:     "not_found",
				Complete: &show,
			},
		},
	}
}

// signupDefinition builds a single-step signup flow: a `credentials`
// step with email+password, on_success=create_user, transitioning to
// the `done` terminal on `submit`.
func signupDefinition() *domain.FlowDefinition {
	createUser := domain.FlowOnSuccessCreateUser
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-signup",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:      "credentials",
				Fields:    []string{"email", "password"},
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:     "done",
				Complete: &show,
			},
		},
	}
}

func TestFlowStateMachine_Start_RendersInitialStep(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	w.authAttemptService.EXPECT().
		Start(gomock.Any(), gomock.Cond(func(in domain.FlowCreateAttemptInput) bool {
			return in.ProjectID == testProjectID
		})).
		Return("att_01TEST", nil).
		Times(1)

	result, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	require.Equal(t, "credentials", result.State.CurrentStep)
	assert.Equal(t, testProjectID, result.State.ProjectID)
	assert.Equal(t, defaultSchemaURL, result.State.UserSchemaURL)
	assert.True(t, containsFieldName(result.Step.Fields, "email"))
	act, ok := findAction(result.Step.Actions, service.FlowActionSubmit)
	assert.True(t, ok)
	assert.True(t, act.Primary)

	assert.Equal(t, "att_01TEST", result.State.AuthAttemptID)
}

func TestFlowStateMachine_Process_RegistrationHappyPath(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	const handoffToken = "handoff_01TEST"
	const email = "alice@example.com"
	const password = "correct-horse-battery-staple"

	var userID string

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.Value == email
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.schemaRepo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), def.ProjectID, def.UserSchema).
		Return(minimalSchema(def.ProjectID), nil).
		Times(1)
	w.db.EXPECT().
		Begin(gomock.Any(), gomock.Any()).
		Return(w.transaction, nil).
		Times(1)
	w.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, user *domain.CreateUser) error {
			userID = user.ID
			return nil
		}).
		Times(1)
	w.passwordRepo.EXPECT().
		DeleteByUserID(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Cond(func(in string) bool {
			return in == userID
		})).
		Times(1)
	w.passwordRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Cond(func(u *domain.CreateUserPassword) bool {
			return u.EncodedHash == "hashed:correct-horse-battery-staple"
		})).
		Times(1)
	w.transaction.EXPECT().Commit(gomock.Any())
	w.authAttemptService.EXPECT().
		RegisterCreatedUser(gomock.Any(), gomock.Cond(func(in domain.FlowRegisterCreatedUserInput) bool {
			return in.UserID == userID
		})).
		Times(1)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     handoffToken,
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil).
		Times(1)

	// Register mode dispatches identifier (the email is x-unique, so it
	// always routes through auth-attempt to emit user_already_exists when
	// the name is taken). It must not dispatch password — create_user
	// establishes the credential per its manifest.
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{
			"email":    email,
			"password": password,
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "done", result.Step.Name)
	if assert.NotNil(t, result.Step.Complete) {
		assert.Equal(t, domain.FlowStepCompleteShow, *result.Step.Complete)
	}

	// create_user pins the user ID and registers them on the attempt so the
	// terminal step can issue a handoff token and auto-sign-in the new user.
	gotUserID, pinned := result.State.CollectedData[service.FlowCollectedUserIDKey]
	assert.True(t, pinned, "create_user must pin _user_id")
	assert.Equal(t, userID, gotUserID)
	assert.Equal(t, handoffToken, result.HandoffToken)
}

func TestFlowStateMachine_Process_LoginHappyPath(t *testing.T) {
	w := newFlowTestWorld(t)

	const email = "alice@example.com"
	const attemptID = "att_01TEST"
	const userID = "user_alice"
	const handoffToken = "handoff_01TEST"

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return assert.Equal(t, attemptID, in.AttemptID) &&
				assert.Equal(t, "email", in.AttributeName) &&
				assert.Equal(t, email, in.Value)
		})).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
			return in.AttemptID == attemptID
		})).
		Times(1)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Cond(func(in domain.FlowHandoffInput) bool {
			return in.AttemptID == attemptID
		})).
		Return(domain.FlowHandoffOutput{
			Token:     handoffToken,
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil).
		Times(1)

	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{
			"email":    email,
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "done", result.Step.Name)

	assert.Equal(t, userID, result.State.CollectedData[service.FlowCollectedUserIDKey])

	assert.Equal(t, handoffToken, result.HandoffToken)
	assert.Equal(t, time.Unix(1700000060, 0).UTC(), result.HandoffTokenExpiresAt)
}

func TestFlowStateMachine_Process_LoginUserNotFound(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	// password must not be submitted when identifier is unknown
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)
	// handoff must not run for an informational terminal reached without an identity
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "ghost@example.com",
			"password": "irrelevant",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "not_found", result.Step.Name)

	assert.Empty(t, result.HandoffToken, "informational terminal must not surface a handoff token")
}

func TestFlowStateMachine_Process_LoginInvalidPassword(t *testing.T) {
	w := newFlowTestWorld(t)

	const email = "alice@example.com"
	const userID = "user_alice"

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Any()).
		Return(domain.ErrAuthAttemptProofRejected(nil))

	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{
			"email":    email,
			"password": "wrong-password",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Contains(t, *result.Step.Error, "password")
}

func TestFlowStateMachine_Process_FieldValidationErrorKeepsStep(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	w.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(0)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "not-an-email",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	if assert.NotNil(t, result.Step.Error) {
		assert.Contains(t, *result.Step.Error, "email")
	}
}

func TestFlowStateMachine_Process_IntegrityOnMissingTargetStep(t *testing.T) {
	w := newFlowTestWorld(t)

	def := signupDefinition()
	// Mutate the submit transition to point at a non-existent step.
	def.Steps[0].Transitions[service.FlowActionSubmit] = domain.FlowStepTransition{Target: "nope"}

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.schemaRepo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), def.ProjectID, def.UserSchema).
		Return(minimalSchema(def.ProjectID), nil).
		Times(1)
	w.db.EXPECT().
		Begin(gomock.Any(), gomock.Any()).
		Return(w.transaction, nil).
		Times(1)
	w.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		DeleteByUserID(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.transaction.EXPECT().Commit(gomock.Any())
	w.authAttemptService.EXPECT().RegisterCreatedUser(gomock.Any(), gomock.Any())

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, service.ErrIntegrity)
}

func TestFlowStateMachine_Process_InvalidActionRejected(t *testing.T) {
	w := newFlowTestWorld(t)

	def := signupDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.schemaRepo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), def.ProjectID, def.UserSchema).
		Return(minimalSchema(def.ProjectID), nil).
		Times(1)
	w.db.EXPECT().
		Begin(gomock.Any(), gomock.Any()).
		Return(w.transaction, nil).
		Times(1)
	w.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		DeleteByUserID(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.transaction.EXPECT().Commit(gomock.Any())
	w.authAttemptService.EXPECT().RegisterCreatedUser(gomock.Any(), gomock.Any())

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: "not_declared",
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, service.ErrInvalidAction)
}

func TestFlowStateMachine_Process_SSOSubmissionUnsupported(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:      service.FlowActionSubmit,
		SSOProvider: &service.FlowSSOProviderRef{ID: "google"},
	})
	require.ErrorIs(t, err, service.ErrUnsupported)
}

// passkeyLoginDefinition builds a single-step passkey login: an
// `authenticate` step offering the `passkey` action, transitioning to the
// `done` terminal once the assertion verifies.
func passkeyLoginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "authenticate",
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionPasskey: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Process_PasskeyIssueThenVerify(t *testing.T) {
	w := newFlowTestWorld(t)

	const userID = "user_alice"
	const challengeID = "ch-1"
	const rpid = "example.com"
	const proof = `{"id":"x"}`
	const publicKey = `{"publicKey":{}}`
	const handoffToken = "handoff_01TEST"

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyChallengeInput) bool {
			return in.RPID == rpid
		})).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(publicKey)}, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPasskey(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyInput) bool {
			return in.ChallengeID == challengeID && string(in.Assertion) == proof
		})).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{
		Token:     handoffToken,
		ExpiresAt: time.Unix(1700000060, 0).UTC(),
	}, nil)

	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Issue leg: selecting the passkey action mints a challenge and halts on the
	// same step, surfacing the ceremony options.
	issued, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:    service.FlowActionPasskey,
		PasskeyRP: &service.FlowPasskeyRP{RPID: rpid, Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
	assert.Equal(t, service.FlowChallengeMethodPasskey, issued.Step.Challenge.Method)
	assert.Equal(t, publicKey, string(issued.Step.Challenge.Options))
	require.NotNil(t, issued.State.PendingChallenge)
	assert.Equal(t, "authenticate", issued.State.CurrentStep)

	// Verify leg: the signed assertion clears the challenge and advances.
	verified, err := w.sm.Process(t.Context(), nil, def, issued.State, service.FlowSubmitInput{
		Action:            service.FlowActionPasskey,
		ChallengeResponse: &service.FlowChallengeResponse{ChallengeID: challengeID, Method: "passkey", Proof: []byte(proof)},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.NotNil(t, verified.Step.Complete)
	assert.Equal(t, handoffToken, verified.HandoffToken)
	assert.Equal(t, userID, verified.State.CollectedData[service.FlowCollectedUserIDKey])
}

func TestFlowStateMachine_Process_PasskeyProofRejectedKeepsStep(t *testing.T) {
	w := newFlowTestWorld(t)

	const challengeID = "ch-1"

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil)
	w.authAttemptService.EXPECT().
		SubmitPasskey(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:    service.FlowActionPasskey,
		PasskeyRP: &service.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), nil, def, issued.State, service.FlowSubmitInput{
		Action:            service.FlowActionPasskey,
		ChallengeResponse: &service.FlowChallengeResponse{ChallengeID: challengeID, Proof: []byte(`{}`)},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, "auth_attempt.passkey_invalid", *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "authenticate", rejected.State.CurrentStep)
}

// passkeyAbandonDefinition offers both a `passkey` and a generic `submit`
// action on the same step, with separate transition targets. Lets a test
// issue a passkey challenge and then submit `submit` to exercise the
// abandonment path.
func passkeyAbandonDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-abandon",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "authenticate",
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},

					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionPasskey: {Target: "done"},
					service.FlowActionSubmit:  {Target: "fallback"},
				},
			},
			{Name: "done", Complete: &show},
			{Name: "fallback", Complete: &show},
		},
	}
}

// Submitting a non-passkey action while a passkey challenge is pending must
// clear the challenge and route via the submitted action, instead of
// re-emitting the passkey prompt and trapping the user on the ceremony.
func TestFlowStateMachine_Process_PasskeyAbandonedOnDifferentAction(t *testing.T) {
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}, nil)
	// no passkey verification should run when no proof was submitted
	w.authAttemptService.EXPECT().SubmitPasskey(gomock.Any(), gomock.Any()).Times(0)

	def := passkeyAbandonDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:    service.FlowActionPasskey,
		PasskeyRP: &service.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	abandoned, err := w.sm.Process(t.Context(), nil, def, issued.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
	})
	require.NoError(t, err)
	assert.Nil(t, abandoned.State.PendingChallenge, "pending challenge must be cleared when the user picks a different action")
	assert.Nil(t, abandoned.Step.Challenge, "the rendered step must not re-attach the abandoned passkey challenge")
	require.NotNil(t, abandoned.Step.Complete, "submit action should advance to the fallback terminal")
}

// passkeyIdentifierLoginDefinition builds a login step that collects the
// identifier on the same step that offers the passkey action — the shape
// the discoverable/non-discoverable passkey UI submits (email + "Login
// with passkey" click).
func passkeyIdentifierLoginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-identifier",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "authenticate",
				Fields: []string{"email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskey:               {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "not_found"},
				},
			},
			{Name: "done", Complete: &show},
			{Name: "not_found", Complete: &show},
		},
	}
}

// Repro for the "passkey login only works after refresh when two users share
// the browser" bug: after attempt 1 rejects (user1 has no passkey), the
// stored _user_id from attempt 1 must not block re-identifying user2 on
// attempt 2. Otherwise the new challenge is still scoped to user1 and the
// second user can never log in.
func TestFlowStateMachine_Process_PasskeyAfterRejectionRebindsIdentifier(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"user1@example.com": "user_one",
		"user2@example.com": "user_two",
	}
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}
	def := passkeyIdentifierLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Attempt 1, issue leg: user1 (password-only) types their email and
	// clicks "Login with passkey". The dispatch loop identifies user1, then
	// processPasskey mints a challenge scoped to user1 (empty allowCredentials
	// since user1 has no passkey).
	issued1, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user1@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued1.State.PendingChallenge)
	require.Len(t, w.attempts.identifyCalls, 1, "attempt 1 must identify user1")
	assert.Equal(t, "user1@example.com", w.attempts.identifyCalls[0].Value)
	assert.Equal(t, "user_one", issued1.State.CollectedData[domain.FlowCollectedUserIDKey])

	// Attempt 1, verify leg: the assertion that comes back doesn't match any
	// credential the attempt is constrained to → server rejects.
	w.attempts.passkeyErr = domain.ErrAuthAttemptProofRejected(nil)
	rejected, err := w.sm.Process(t.Context(), nil, def, issued1.State, domain.FlowSubmitInput{
		Action:            domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{ChallengeID: "ch-1", Method: domain.FlowChallengeMethodPasskey, Proof: []byte(`{}`)},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, "auth_attempt.passkey_invalid", *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge, "rejection clears PendingChallenge")

	// Attempt 2, issue leg: the user re-types user2's email (passkey-only)
	// and clicks "Login with passkey" again. user2 must be re-identified so
	// the new challenge is scoped to user2's credentials. Before this fix,
	// the dispatch loop skipped SubmitIdentifier whenever a previous _user_id
	// was stored, leaving the attempt bound to user1.
	w.attempts.passkeyErr = nil
	w.attempts.passkeyUserID = "user_two"
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-2", Options: []byte(`{"publicKey":{}}`)}

	issued2, err := w.sm.Process(t.Context(), nil, def, rejected.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user2@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued2.State.PendingChallenge, "attempt 2 must issue a fresh passkey challenge")

	require.Len(t, w.attempts.identifyCalls, 2,
		"attempt 2 must re-run SubmitIdentifier for the new email; the stored _user_id from attempt 1 must not short-circuit it")
	assert.Equal(t, "user2@example.com", w.attempts.identifyCalls[1].Value,
		"attempt 2 must dispatch the user2 identifier")
	assert.Equal(t, "user_two", issued2.State.CollectedData[domain.FlowCollectedUserIDKey],
		"_user_id must be rebound to user_two so the new passkey challenge is scoped to their credentials")
}

// Re-submitting the same identifier resolves to the same user, so the
// in-flight ceremony survives. The dispatch re-runs (the auth-attempt is
// the source of truth for whether the binding should change); the resolved
// user id is the same, so PendingChallenge is preserved.
func TestFlowStateMachine_Process_PasskeyResubmitSameIdentifierKeepsPendingChallenge(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{"user1@example.com": "user_one"}
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}
	def := passkeyIdentifierLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	first, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user1@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.Len(t, w.attempts.identifyCalls, 1)

	// Same email re-submitted (e.g. user clicked the passkey action again
	// after dismissing the browser prompt). Same user resolved → ceremony stays.
	second, err := w.sm.Process(t.Context(), nil, def, first.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user1@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	assert.Len(t, w.attempts.identifyCalls, 2, "every dispatch calls SubmitIdentifier")
	require.NotNil(t, second.State.PendingChallenge, "same user resolved — ceremony survives")
	assert.Equal(t, "user_one", second.State.CollectedData[domain.FlowCollectedUserIDKey])
}

// ---- CurrentPurpose + outcome flip ----

func TestFlowStateMachine_Start_InitializesCurrentPurpose(t *testing.T) {
	tests := []struct {
		name    string
		purpose domain.FlowDefinitionPurpose
	}{
		{"login", domain.FlowDefinitionPurposeLogin},
		{"register", domain.FlowDefinitionPurposeRegister},
		{"recovery", domain.FlowDefinitionPurposeRecovery},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := newFlowTestWorld(t)
			def := signupDefinition()

			w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

			// signupDefinition only declares Register; register the other purposes
			// so Start can resolve an entry step.
			def.Purposes[domain.FlowDefinitionPurposeLogin] = "credentials"
			def.Purposes[domain.FlowDefinitionPurposeRecovery] = "credentials"

			result, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
				Definition:    def,
				Purpose:       tc.purpose,
				Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)
			assert.Equal(t, tc.purpose, result.State.Purpose)
			assert.Equal(t, tc.purpose, result.State.CurrentPurpose)
		})
	}
}

func TestFlowStateMachine_FlipTable_LoginUserNotFoundFlipsToRegister(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "password": "irrelevant"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.Purpose, "Purpose stays pinned")
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose)
}

func TestFlowStateMachine_FlipTable_RecoveryPassthrough(t *testing.T) {
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	def := loginDefinition()
	delete(def.Purposes, domain.FlowDefinitionPurposeLogin)
	def.Purposes[domain.FlowDefinitionPurposeRecovery] = "credentials"

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "password": "irrelevant"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeRecovery, result.State.CurrentPurpose)
}

// passkeyIdentifierDefinition mirrors the default login flow's identifier
// step: an email field plus `submit` (→ password) and `passkey` (→ done)
// actions, with `user_not_found` routing to a register step. Lets a test
// drive the passkey-issue path with an unknown email so the early dispatch
// short-circuits and the engine routes via user_not_found.
func passkeyIdentifierDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-identifier",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identifier",
			domain.FlowDefinitionPurposeRegister: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []string{"email"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Primary: true},
					{Name: service.FlowActionPasskey},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit:               {Target: "password"},
					service.FlowActionPasskey:              {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "register"},
				},
			},
			{
				Name:   "password",
				Fields: []string{"password"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:   "register",
				Fields: []string{"email"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// TestFlowStateMachine_FlipTable_PasskeyIssue_UnknownEmail_FlipsToRegister
// pins the bug where selecting `passkey` on the identifier step with an
// unknown email routed via `user_not_found` to the register step but left
// CurrentPurpose pinned at `login`. The next submit then ran identifier
// verification in login mode and rejected the same email as user_not_found
// again. Mirrors the flip the non-passkey dispatch path already applies.
func TestFlowStateMachine_FlipTable_PasskeyIssue_UnknownEmail_FlipsToRegister(t *testing.T) {
	w := newFlowTestWorld(t)
	def := passkeyIdentifierDefinition()

	const email = "ghost@example.com"

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return assert.Equal(t, email, in.Value)
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	w.authAttemptService.EXPECT().IssuePasskeyChallenge(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:    service.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &service.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", result.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.Purpose, "Purpose stays pinned")
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose,
		"early-passkey dispatch must flip CurrentPurpose on user_not_found, parity with the non-passkey path")
	assert.Nil(t, result.State.PendingChallenge, "passkey challenge must not be issued when identifier dispatch already produced an outcome")
}

// loginNoUserNotFoundDefinition is a login-only flow whose identifier
// step does NOT wire a user_not_found transition. Lets a test exercise
// the "outcome without a transition" path.
func loginNoUserNotFoundDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-login-no-unf",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "credentials",
				Fields: []string{"email", "password"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// TestFlowStateMachine_FlipTable_OutcomeWithoutTransition_DoesNotFlip
// pins the invariant that CurrentPurpose flips only when a flip outcome
// is actually routed. Dispatch returns user_not_found but the step has
// no transition for it; the engine surfaces a step error and the mode
// must stay at login so the next submit doesn't silently dispatch as
// register.
func TestFlowStateMachine_FlipTable_OutcomeWithoutTransition_DoesNotFlip(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginNoUserNotFoundDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "password": "irrelevant"},
	})
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.State.CurrentStep, "no transition for user_not_found keeps the user on the current step")
	assert.Equal(t, new(domain.FlowImplicitOutcomeUserNotFound), result.Step.Error)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose,
		"CurrentPurpose must not flip when the routed outcome had no transition wired")
}

// TestFlowStateMachine_FlipTable_LoginTypoThenCorrectEmail_StillSignsIn
// is the user-visible motivation for the no-phantom-flip invariant. The
// user mistypes their email on a login-only flow with no user_not_found
// transition; the engine renders a step error and the user retries with
// the correct (existing) address. Without the gate, CurrentPurpose would
// have flipped to register on the typo and the second attempt would see
// the known email as user_already_exists, wedging the sign-in.
func TestFlowStateMachine_FlipTable_LoginTypoThenCorrectEmail_StillSignsIn(t *testing.T) {
	w := newFlowTestWorld(t)

	const handoffToken = "handoff_01TEST"
	const email = "alice@example.com"
	const userID = "user_alice"

	def := loginNoUserNotFoundDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.Value == email
		})).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(1)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     handoffToken,
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil).
		Times(1)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Typo: dispatch returns user_not_found, no transition wired,
	// engine surfaces a step error and the user stays on credentials.
	typo, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": email, "password": "irrelevant"},
	})
	require.NoError(t, err)
	require.Equal(t, "credentials", typo.State.CurrentStep)
	require.NotNil(t, typo.Step.Error)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, typo.State.CurrentPurpose,
		"phantom flip on the typo would wedge the retry below")

	// Retry with the correct (known) email: still in login mode, so
	// identifier resolves, password verifies, and the user signs in.
	result, err := w.sm.Process(t.Context(), nil, def, typo.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": email, "password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", result.State.CurrentStep)
	assert.Equal(t, userID, result.State.CollectedData[service.FlowCollectedUserIDKey])
	assert.NotEmpty(t, result.HandoffToken, "handoff issued for completed sign-in")
}

func TestFlowState_JSONRoundTrip_PreservesCurrentPurpose(t *testing.T) {
	state := domain.FlowState{
		ID:        "flow-1",
		ProjectID: "proj-1",
		FlowProgress: domain.FlowProgress{
			DefinitionID:   "def-1",
			Purpose:        domain.FlowDefinitionPurposeLogin,
			CurrentPurpose: domain.FlowDefinitionPurposeRegister,
			CurrentStep:    "credentials",
			CollectedData:  map[string]any{},
		},
	}
	payload, err := json.Marshal(state)
	require.NoError(t, err)

	var decoded domain.FlowState
	require.NoError(t, json.Unmarshal(payload, &decoded))
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, decoded.Purpose)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, decoded.CurrentPurpose)
}

func TestFlowState_JSONRoundTrip_PivotPushPopPreservesCurrentPurpose(t *testing.T) {
	parent := domain.FlowProgress{
		DefinitionID:   "def-parent",
		Purpose:        domain.FlowDefinitionPurposeLogin,
		CurrentPurpose: domain.FlowDefinitionPurposeRegister,
		CurrentStep:    "parent-step",
		CollectedData:  map[string]any{},
	}
	state := domain.FlowState{
		ID:        "flow-1",
		ProjectID: "proj-1",
		FlowProgress: domain.FlowProgress{
			DefinitionID:   "def-child",
			Purpose:        domain.FlowDefinitionPurposeLogin,
			CurrentPurpose: domain.FlowDefinitionPurposeLogin,
			CurrentStep:    "child-step",
			CollectedData:  map[string]any{},
		},
		PivotStack: []domain.FlowProgress{parent},
	}

	payload, err := json.Marshal(state)
	require.NoError(t, err)
	var decoded domain.FlowState
	require.NoError(t, json.Unmarshal(payload, &decoded))

	require.Len(t, decoded.PivotStack, 1)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, decoded.PivotStack[0].CurrentPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, decoded.CurrentPurpose)
}

// ---- Dispatch worked examples ----

// multiStepSignupDefinition is worked example A.
func multiStepSignupDefinition() *domain.FlowDefinition {
	createUser := domain.FlowOnSuccessCreateUser
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-multi-signup",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "profile",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "profile",
				Fields: []string{"email"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit:                    {Target: "set-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "done"},
				},
			},
			{
				Name:   "set-password",
				Fields: []string{"password"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "create"},
				},
			},
			{
				Name:      "create",
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// combinedSigninSignupDefinition is worked example C.
func combinedSigninSignupDefinition() *domain.FlowDefinition {
	createUser := domain.FlowOnSuccessCreateUser
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-combined",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identify",
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []string{"email"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit:                    {Target: "signin-password"},
					domain.FlowImplicitOutcomeUserNotFound:      {Target: "register-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "signin-password"},
				},
			},
			{
				Name:   "signin-password",
				Fields: []string{"password"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:      "register-password",
				Fields:    []string{"password"},
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// recoveryDefinition is worked example D.
func recoveryDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-recovery",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRecovery: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []string{"email"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit:               {Target: "new-password"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "done"},
				},
			},
			{
				Name:   "new-password",
				Fields: []string{"password"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// Worked example A: register-mode multi-step; identifier on profile,
// password on set-password, create_user on `create`.
func TestFlowDispatch_RegisterMultiStep_HappyPath(t *testing.T) {
	const email = "fresh@example.com"

	w := newFlowTestWorld(t)
	def := multiStepSignupDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.schemaRepo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), def.ProjectID, def.UserSchema).
		Return(minimalSchema(def.ProjectID), nil).
		Times(1)
	w.db.EXPECT().
		Begin(gomock.Any(), gomock.Any()).
		Return(w.transaction, nil).
		Times(1)
	w.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		DeleteByUserID(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.transaction.EXPECT().Commit(gomock.Any())
	w.authAttemptService.EXPECT().RegisterCreatedUser(gomock.Any(), gomock.Any())
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)
	// register mode never verifies password
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterProfile, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "set-password", afterProfile.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterProfile.State.CurrentPurpose)

	afterPassword, err := w.sm.Process(t.Context(), nil, def, afterProfile.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "create", afterPassword.State.CurrentStep)

	done, err := w.sm.Process(t.Context(), nil, def, afterPassword.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
}

// Register entry, identifier already exists → user_already_exists +
// flip to login.
func TestFlowDispatch_RegisterEntry_IdentifierAlreadyExists_Flips(t *testing.T) {
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_existing", nil)

	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": "taken@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose)
	assert.Equal(t, "done", result.State.CurrentStep)
}

// Worked example C: login entry, unknown email → flip + create_user runs.
func TestFlowDispatch_CombinedFlow_LoginUnknownEmail_FlipsAndCreates(t *testing.T) {
	const email = "ghost@example.com"
	w := newFlowTestWorld(t)
	def := combinedSigninSignupDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.schemaRepo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), def.ProjectID, def.UserSchema).
		Return(minimalSchema(def.ProjectID), nil).
		Times(1)
	w.db.EXPECT().
		Begin(gomock.Any(), gomock.Any()).
		Return(w.transaction, nil).
		Times(1)
	w.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		DeleteByUserID(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passwordRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.transaction.EXPECT().Commit(gomock.Any())
	w.authAttemptService.EXPECT().RegisterCreatedUser(gomock.Any(), gomock.Any())
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "register-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterIdentify.State.CurrentPurpose)

	done, err := w.sm.Process(t.Context(), nil, def, afterIdentify.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
}

// Worked example C variant: register entry, identifier exists → flip
// to login + signin-password verifies.
func TestFlowDispatch_CombinedFlow_RegisterKnownEmail_FlipsToSignin(t *testing.T) {
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_alice", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(1)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	def := combinedSigninSignupDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "signin-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, afterIdentify.State.CurrentPurpose)

	done, err := w.sm.Process(t.Context(), nil, def, afterIdentify.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
}

// Worked example D: recovery identifies but never verifies password.
func TestFlowDispatch_Recovery_IdentifierResolvedPasswordNotDispatched(t *testing.T) {
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_alice", nil).
		Times(1)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	def := recoveryDefinition()

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "new-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRecovery, afterIdentify.State.CurrentPurpose)

	_, err = w.sm.Process(t.Context(), nil, def, afterIdentify.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{"password": "fresh-secret"},
	})
	require.NoError(t, err)
}

// passkeyRegisterDefinition builds a two-step registration flow:
// an `identify` step (identifier field) followed by a `register` step
// offering the `passkey_register` action, transitioning to `done`.
func passkeyRegisterDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "register",
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Process_PasskeyRegisterIssueThenVerify(t *testing.T) {
	// TODO fix user id
	const userID = ""
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const proof = `{"attestation":"fake"}`

	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.passkeyRegService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyRegistrationChallengeInput) bool {
			return assert.Equal(t, userID, in.UserID)
		})).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			Options:     []byte(registrationOpts),
		}, nil)
	w.schemaRepo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), def.ProjectID, def.UserSchema).
		Return(minimalSchema(def.ProjectID), nil).
		Times(1)
	w.userRepo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		Times(1)
	w.passkeyRegService.EXPECT().
		SubmitPasskeyRegistration(gomock.Any(), gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyRegistrationInput) bool {
			return assert.Equal(t, challengeID, in.ChallengeID) &&
				assert.Equal(t, proof, string(in.Attestation))
		}))
	w.authAttemptService.EXPECT().RegisterCreatedUser(gomock.Any(), gomock.Any())
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Issue leg: passkey_register action mints a creation challenge.
	issued, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:    service.FlowActionPasskeyRegister,
		PasskeyRP: &service.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
	assert.Equal(t, service.FlowChallengeMethodPasskeyRegister, issued.Step.Challenge.Method)
	require.NotNil(t, issued.State.PendingChallenge)

	// Verify leg: attestation clears the challenge and advances to done.
	verified, err := w.sm.Process(t.Context(), nil, def, issued.State, service.FlowSubmitInput{
		Action: service.FlowActionPasskeyRegister,
		ChallengeResponse: &service.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      service.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(proof),
		},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.NotNil(t, verified.Step.Complete)
}

func TestFlowStateMachine_Process_PasskeyRegisterRejectedKeepsStep(t *testing.T) {
	const userID = "user_alice"
	const challengeID = "reg-1"
	const registrationOpts = `{}`
	const proof = `{}`

	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.passkeyRegService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyRegistrationChallengeInput) bool {
			return assert.Equal(t, userID, in.UserID)
		})).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			Options:     []byte(registrationOpts),
		}, nil)
	w.passkeyRegService.EXPECT().
		SubmitPasskeyRegistration(gomock.Any(), gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyRegistrationInput) bool {
			return assert.Equal(t, challengeID, in.ChallengeID) &&
				assert.Equal(t, proof, string(in.Attestation))
		})).
		Return(domain.ErrAuthAttemptProofRejected(nil))

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	start.State.CollectedData[service.FlowCollectedUserIDKey] = "user_alice"

	issued, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:    service.FlowActionPasskeyRegister,
		PasskeyRP: &service.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), nil, def, issued.State, service.FlowSubmitInput{
		Action: service.FlowActionPasskeyRegister,
		ChallengeResponse: &service.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      service.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(proof),
		},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, "auth_attempt.passkey_registration_invalid", *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "register", rejected.State.CurrentStep)
}

// TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID verifies that
// when no user is identified yet (passkey-only registration path), the state
// machine generates a provisional user ID and issues the challenge successfully.
func TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID(t *testing.T) {
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`

	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	// The provisional user ID should have been generated and passed to the service.
	w.passkeyRegService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	// No user ID seeded — the state machine should generate one.

	issued, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action:    service.FlowActionPasskeyRegister,
		PasskeyRP: &service.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	// The generated ID should be stored in CollectedData for use in the verify phase.
	assert.NotEmpty(t, issued.State.CollectedData[service.FlowCollectedUserIDKey])
}

// TestFlowStateMachine_Start_PreservesActionOrder pins ADR 021: the rendered
// step's Actions list reflects the definition order, not Go map iteration.
func TestFlowStateMachine_Start_PreservesActionOrder(t *testing.T) {
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	show := domain.FlowStepCompleteShow
	def := &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-order",
		UserSchema: defaultSchemaURL,
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "step",
				Fields: []string{"email"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "register", Kind: domain.FlowActionKindSubmit},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionPasskey: {Target: "done"},
					service.FlowActionSubmit:  {Target: "done"},
					"register":                {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}

	result, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	gotNames := make([]string, len(result.Step.Actions))
	for i, a := range result.Step.Actions {
		gotNames[i] = a.Name
	}
	assert.Equal(t, []string{service.FlowActionPasskey, service.FlowActionSubmit, "register"}, gotNames)
}

// TestFlowStateMachine_Process_NavigateSkipsValidation verifies that a
// navigate-kind action on a step with required fields routes via its
// transition without running field validation. This is the engine's
// half of ADR 026 — a back-navigation action can be invoked with empty
// fields and the engine must not block on missing email/password.
func TestFlowStateMachine_Process_NavigateSkipsValidation(t *testing.T) {
	w := newFlowTestWorld(t)
	show := domain.FlowStepCompleteShow
	def := &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-navigate",
		UserSchema: defaultSchemaURL,
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "enter"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "enter",
				Fields: []string{"email", "password"},
				Actions: []domain.FlowStepAction{
					{Name: service.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "back", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					service.FlowActionSubmit: {Target: "done"},
					"back":                   {Target: "landing"},
				},
			},
			{Name: "landing", Complete: &show},
			{Name: "done", Complete: &show},
		},
	}

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Empty fields would fail validation under a submit action; navigate
	// must skip validation and follow the transition.
	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: "back",
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, "landing", result.Step.Name)
	assert.Nil(t, result.Step.Error, "navigate must not surface field-validation errors")
}

// TestFlowStateMachine_Process_SubmitKindRegression confirms that the
// kind-based dispatch keeps the standard submit pipeline intact — a
// malformed email under a submit action surfaces a field-validation error
// rather than routing through, exactly as before.
func TestFlowStateMachine_Process_SubmitKindRegression(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), nil, service.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       service.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, service.FlowSubmitInput{
		Action: service.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "not-an-email",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	if assert.NotNil(t, result.Step.Error, "submit kind must still run field validation") {
		assert.Contains(t, *result.Step.Error, "email")
	}
}
