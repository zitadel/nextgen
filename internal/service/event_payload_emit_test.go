package service_test

import (
	"context"
	"encoding/json"
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

func TestProjectCreate_EventPayloadIncludesPreviewOrigins(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	masterKey := cryptomock.NewMockCrypter(ctrl)
	keyService := servicemocks.NewMockKeyService(ctrl)
	keyService.EXPECT().GetMasterKeyCrypter(gomock.Any()).Return(masterKey, nil).AnyTimes()
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, tx func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return tx(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()

	var events []*domain.Event
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			events = append(events, ev)
			return nil
		},
	).AnyTimes()

	statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p *domain.Project) error {
			p.ID = "proj_origins"
			return nil
		},
	)
	masterKey.EXPECT().Encrypt(gomock.Any())
	masterKey.EXPECT().Decrypt(gomock.Any()).Return("thiskeyis32byteslongforsurerealy", nil)
	statements.EXPECT().NewManagedID(string(domain.PrefixEncryptionKey)).Return("enc_key_minted", nil)
	statements.EXPECT().CreateEncryptionKey(gomock.Any(), gomock.Any()).Times(4)
	statements.EXPECT().CreateSigningKey(gomock.Any(), gomock.Any()).Times(1)
	statements.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any())
	statements.EXPECT().CreateJSONSchema(gomock.Any(), gomock.Any())
	statements.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any())

	const baseURL = "https://example.com/api/schemas"
	schemaValidator, err := domain.NewSchemaValidator(baseURL)
	require.NoError(t, err)
	svc := service.NewProjectService(service.NewPool(pool), baseURL, schemaValidator, keyService)

	got, err := svc.Create(t.Context(), "Acme", []string{"*.vercel.app"}, true)
	require.NoError(t, err)
	require.NotNil(t, got)

	var created *domain.Event
	for _, ev := range events {
		if ev.EventType == domain.EventTypeProjectCreated {
			created = ev
			break
		}
	}
	require.NotNil(t, created, "expected project.created event")
	var payload domain.ProjectPayload
	require.NoError(t, json.Unmarshal(created.Payload, &payload))
	assert.Equal(t, "Acme", payload.Name)
	assert.Equal(t, []string{"*.vercel.app"}, payload.PreviewOrigins)
}

func TestProjectUpdate_EventPayloadNameDelta(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	masterKey := cryptomock.NewMockCrypter(ctrl)
	keyService := servicemocks.NewMockKeyService(ctrl)
	keyService.EXPECT().GetMasterKeyCrypter(gomock.Any()).Return(masterKey, nil).AnyTimes()
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, tx func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return tx(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()

	var gotEvent *domain.Event
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			gotEvent = ev
			return nil
		},
	)
	statements.EXPECT().UpdateProject(gomock.Any(), gomock.Any()).Return(nil)

	const baseURL = "https://example.com/api/schemas"
	schemaValidator, err := domain.NewSchemaValidator(baseURL)
	require.NoError(t, err)
	svc := service.NewProjectService(service.NewPool(pool), baseURL, schemaValidator, keyService)

	_, err = svc.Update(t.Context(), "proj_1", "renamed")
	require.NoError(t, err)
	require.NotNil(t, gotEvent)
	assert.Equal(t, domain.EventTypeProjectUpdated, gotEvent.EventType)
	var payload domain.ProjectPayload
	require.NoError(t, json.Unmarshal(gotEvent.Payload, &payload))
	assert.Equal(t, "renamed", payload.Name)
	assert.Nil(t, payload.PreviewOrigins)
}

func TestAuthAttempt_CheckPayloadIncludesAttemptID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	f := newPasskeyFixture(t)
	attempt, assertion := f.challengeAttempt(t, "ch-1")

	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool := servicemocks.NewMockPool(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(stmts).AnyTimes()

	var gotEvent *domain.Event
	stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			gotEvent = ev
			return nil
		},
	)
	stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)
	stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), "proj", "att-1", gomock.Any(), "ch-1").Return(nil)
	expectListUserPasskeys(stmts, []*domain.UserPasskey{f.passkey})
	stmts.EXPECT().UpdateUserPasskey(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)

	svc := service.NewAuthAttemptService(service.NewPool(pool), nil, nil, nil)
	_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
		ProjectID:   "proj",
		AttemptID:   "att-1",
		ChallengeID: "ch-1",
		Proof:       service.PasskeyProof{AssertionResponse: assertion},
	})
	require.NoError(t, err)
	require.NotNil(t, gotEvent)
	assert.Equal(t, domain.EventTypeAuthCheckSucceeded, gotEvent.EventType)
	var payload domain.AuthCheckPayload
	require.NoError(t, json.Unmarshal(gotEvent.Payload, &payload))
	assert.Equal(t, "ch-1", payload.CheckID)
	assert.Equal(t, "att-1", payload.AuthAttemptID)
}

func TestAuthAttempt_HandoffEmptyPayloadKeepsSessionColumn(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	sessionID := "sess_1"
	attempt := &domain.AuthAttempt{
		ProjectID:      "proj",
		ID:             "att-1",
		SessionID:      &sessionID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
	}

	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool := servicemocks.NewMockPool(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(stmts).AnyTimes()

	var gotEvent *domain.Event
	stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			gotEvent = ev
			return nil
		},
	)
	stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)
	stmts.EXPECT().HandoffAuthAttempt(gomock.Any(), gomock.Any()).Return(nil)

	svc := service.NewAuthAttemptService(service.NewPool(pool), nil, nil, nil)
	_, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"})
	require.NoError(t, err)
	require.NotNil(t, gotEvent)
	assert.Equal(t, domain.EventTypeAuthAttemptHandedOff, gotEvent.EventType)
	assert.JSONEq(t, `{}`, string(gotEvent.Payload))
	require.NotNil(t, gotEvent.SessionID)
	assert.Equal(t, sessionID, *gotEvent.SessionID)
}

func TestCreateUserAction_EventPayloadAttributeKeys(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)

	schemaURL := "https://example.test/schema.json"
	schemaJSON := []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://example.test/schema.json",
		"type": "object",
		"properties": {
			"email": {"type": "string", "format": "email", "x-unique": "project", "x-audit": true},
			"givenName": {"type": "string"}
		}
	}`)
	schemaStore.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", schemaURL).
		Return(&domain.JSONSchema{ProjectID: "proj_1", URL: schemaURL, Schema: schemaJSON}, nil)

	action := service.NewCreateUserAction(service.CreateUserInput{
		ProjectID: "proj_1",
		User: map[string]any{
			"$schema":   schemaURL,
			"email":     "alice@example.com",
			"givenName": "Alice",
		},
	}, schemaStore)
	require.NoError(t, action.Prepare(t.Context()))
	action.CreateUser.ID = "user_1"

	var gotEvent *domain.Event
	stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, u *domain.CreateUser) error {
			u.ID = "user_1"
			return nil
		},
	)
	stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			gotEvent = ev
			return nil
		},
	)

	require.NoError(t, action.Apply(t.Context(), stmts))
	require.NotNil(t, gotEvent)
	assert.Equal(t, domain.EventTypeUserCreated, gotEvent.EventType)
	assert.Equal(t, "user_1", *gotEvent.EntityID)

	var payload domain.UserCreatedPayload
	require.NoError(t, json.Unmarshal(gotEvent.Payload, &payload))
	assert.Equal(t, schemaURL, payload.SchemaID)
	assert.Equal(t, []string{"email", "givenName"}, payload.AttributeKeys)
	require.NotNil(t, payload.Attributes)
	assert.Equal(t, "alice@example.com", payload.Attributes["email"])
	_, hasGiven := payload.Attributes["givenName"]
	assert.False(t, hasGiven, "non-x-audit values must be omitted")
	assert.NotContains(t, string(gotEvent.Payload), `"user_id"`)
}

func TestSetPasswordAction_UsesPasswordRowID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	hasher := cryptomock.NewMockHasher(ctrl)
	hasher.EXPECT().Hash("s3cret").Return("hash", nil)

	action := service.NewSetUserPasswordAction(service.SetPasswordInput{
		ProjectID: "proj_1",
		UserID:    "user_1",
		Password:  "s3cret",
	}, hasher)
	require.NoError(t, action.Prepare(t.Context()))

	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().SetUserPassword(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, pw *domain.SetUserPassword) error {
			pw.ID = "upw_minted01"
			return nil
		},
	)
	var gotEvent *domain.Event
	stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			gotEvent = ev
			return nil
		},
	)

	require.NoError(t, action.Apply(t.Context(), stmts))
	require.NotNil(t, gotEvent)
	assert.Equal(t, domain.EventTypeAuthFactorPasswordSet, gotEvent.EventType)
	require.NotNil(t, gotEvent.EntityID)
	assert.Equal(t, "upw_minted01", *gotEvent.EntityID)
	var payload domain.AuthFactorPayload
	require.NoError(t, json.Unmarshal(gotEvent.Payload, &payload))
	assert.Equal(t, "user_1", payload.UserID)
	assert.Equal(t, "upw_minted01", payload.FactorID)
}

func TestBrandingCreate_EventPayloadURLs(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()

	var gotEvent *domain.Event
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ev *domain.Event) error {
			gotEvent = ev
			return nil
		},
	)
	statements.EXPECT().CreateBranding(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, b *domain.Branding) error {
			b.ID = "brnd_1"
			return nil
		},
	)

	svc := service.NewBrandingService(service.NewPool(pool))
	_, err := svc.Create(t.Context(), service.CreateBrandingInput{
		ProjectID:      "proj_1",
		Layout:         domain.BrandingLayoutSplit,
		LiquidTemplate: "<div>{% mandatory_gates %}</div>",
		LogoURL:        "https://cdn.example.com/logo.svg",
		HeroURL:        "https://cdn.example.com/hero.png",
	})
	require.NoError(t, err)
	require.NotNil(t, gotEvent)
	var payload domain.BrandingPayload
	require.NoError(t, json.Unmarshal(gotEvent.Payload, &payload))
	assert.Equal(t, domain.BrandingLayoutSplit, payload.Layout)
	assert.Equal(t, "https://cdn.example.com/logo.svg", payload.LogoURL)
	assert.Equal(t, "https://cdn.example.com/hero.png", payload.HeroURL)
	assert.Empty(t, payload.FontURL, "font_url is not writable yet; omit when empty")
	assert.NotContains(t, string(gotEvent.Payload), "liquid")
}
