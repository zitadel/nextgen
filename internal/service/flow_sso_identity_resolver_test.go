package service_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	ssoProjectID  = "proj-1"
	ssoAttemptID  = "att-1"
	ssoSchemaURL  = "https://example.test/user.schema.json"
	ssoRevisionID = "idprev-1"
)

// ssoConnectionDocument is a minimal connection revision the engine parses.
const ssoConnectionDocument = `{
	"slug": "google",
	"protocol": "oidc",
	"display_name": "Google",
	"provisioning": {"creation": "disabled"},
	"oidc": {
		"issuer": "https://accounts.example.test",
		"client_id": "client",
		"client_secret": "${{ GOOGLE_SECRET }}",
		"scopes": ["openid"]
	}
}`

type ssoResolverFixture struct {
	pool        *servicemocks.MockStatementPool
	stmts       *servicemocks.MockAllStatements
	connections *servicemocks.MockIDPConnectionService
	schemaStore *domainmock.MockJSONSchemaStore
	resolver    *service.FlowSSOIdentityResolver
	// events are the events expectCreateUser saw inserted.
	events []*domain.Event
}

func newSSOResolverFixture(t *testing.T) *ssoResolverFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	users := service.NewUserService(pool, schemaStore, nil, nil)
	return &ssoResolverFixture{
		pool:        pool,
		stmts:       stmts,
		connections: connections,
		schemaStore: schemaStore,
		resolver:    service.NewFlowSSOIdentityResolver(pool, connections, users, schemaStore),
	}
}

// inTransaction runs the transaction callback on the fixture's statements.
func (f *ssoResolverFixture) inTransaction(t *testing.T) {
	statementer := servicemocks.NewMockStatementer[service.AllStatements](gomock.NewController(t))
	statementer.EXPECT().Statements().Return(f.stmts).AnyTimes()
	f.pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	)
}

func parkedAttempt(result *domain.SSOCallbackResult, factors ...domain.AuthCheck) *domain.AuthAttempt {
	checks := append([]domain.AuthCheck{&domain.SSOCallbackCheck{ID: "ch-1", Result: result}}, factors...)
	return &domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: checks}
}

func parkedResult() *domain.SSOCallbackResult {
	return &domain.SSOCallbackResult{
		Subject:              "sub-1",
		ConnectionRevisionID: ssoRevisionID,
		Claims:               map[string]any{"email": "alice@example.com"},
		Verified:             map[string]bool{"email": true},
	}
}

// expectParked wires the reads LoadParked makes up to the link lookup.
func (f *ssoResolverFixture) expectParked(link *domain.IDPIdentityLink, linkErr error) {
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), ssoProjectID, ssoRevisionID).
		Return(&domain.IDPConnection{ProjectID: ssoProjectID, ID: "idp-1", RevisionID: ssoRevisionID, Document: []byte(ssoConnectionDocument)}, nil)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Return(link, linkErr)
}

func loadInput() domain.FlowSSOLoadInput {
	return domain.FlowSSOLoadInput{ProjectID: ssoProjectID, AttemptID: ssoAttemptID, UserSchemaURL: ssoSchemaURL}
}

func TestFlowSSOIdentityResolver_LoadParked_NoResultReturnsNil(t *testing.T) {
	t.Parallel()
	for name, attempt := range map[string]*domain.AuthAttempt{
		"no sso row":        {ProjectID: ssoProjectID, ID: ssoAttemptID},
		"row still pending": parkedAttempt(nil),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(attempt, nil)

			got, err := f.resolver.LoadParked(t.Context(), loadInput())
			require.NoError(t, err)
			assert.Nil(t, got)
		})
	}
}

func boundFactors() []domain.AuthCheck {
	return []domain.AuthCheck{
		&domain.AuthFactorUser{UserID: "user-1"},
		&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-1", AttemptID: ssoAttemptID},
	}
}

// A previous request bound the attempt and deleted the parked row, then lost
// its handoff: the bound user is reported so the handoff can be retried.
func TestFlowSSOIdentityResolver_LoadParked_BoundAttemptReportsUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(&domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: boundFactors()}, nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Times(0)

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	assert.Equal(t, &domain.FlowSSOParkedIdentity{BoundUserID: "user-1", AttemptUserID: "user-1"}, got)
}

// A new attempt started from an SSO session inherits the session's factors,
// including an sso factor another attempt wrote: that is no lost settlement.
func TestFlowSSOIdentityResolver_LoadParked_SessionCopiedSSOFactorIsNotARetryMarker(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	copied := []domain.AuthCheck{
		&domain.AuthFactorUser{UserID: "user-1"},
		&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-1", AttemptID: "att-earlier"},
	}
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(&domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: copied}, nil)

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestFlowSSOIdentityResolver_LoadParked_BoundAttemptWithParkedResultPrefersResult(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), boundFactors()...), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), ssoProjectID, ssoRevisionID).
		Return(&domain.IDPConnection{ProjectID: ssoProjectID, ID: "idp-1", RevisionID: ssoRevisionID, Document: []byte(ssoConnectionDocument)}, nil)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "ch-1", got.CheckID)
	assert.Empty(t, got.BoundUserID)
}

// After a successful handoff there is nothing to retry: a second load with an
// older cookie renders the step instead of failing on a second handoff.
func TestFlowSSOIdentityResolver_LoadParked_HandedOffBoundAttemptIsNil(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	handedOff := time.Now()
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(&domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: boundFactors(), HandedOffAt: &handedOff}, nil)

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestFlowSSOIdentityResolver_LoadParked_LinkFound(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectParked(&domain.IDPIdentityLink{ID: "idplink-1", ConnectionID: "idp-1", Subject: "sub-1", UserID: "user-1"}, nil)
	f.stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.User{ID: "user-1", SchemaURL: ssoSchemaURL}, nil)

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	assert.Equal(t, &domain.FlowSSOParkedIdentity{
		CheckID:          "ch-1",
		ConnectionID:     "idp-1",
		Subject:          "sub-1",
		Claims:           map[string]any{"email": "alice@example.com"},
		Verified:         map[string]bool{"email": true},
		CreationDisabled: true,
		Link:             &domain.FlowSSOLinkedUser{LinkID: "idplink-1", UserID: "user-1"},
	}, got)
}

func TestFlowSSOIdentityResolver_LoadParked_LinkMissIsNil(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectParked(nil, database.NewNoRowFoundError(nil))

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Nil(t, got.Link)
	assert.Equal(t, "idp-1", got.ConnectionID, "the link is looked up by the stable connection id")
}

func TestFlowSSOIdentityResolver_LoadParked_OtherSchemaRestartsAndLogsBoth(t *testing.T) {
	t.Parallel()
	const otherSchemaURL = "https://example.test/staff.schema.json"
	f := newSSOResolverFixture(t)
	f.expectParked(&domain.IDPIdentityLink{ID: "idplink-1", UserID: "user-1"}, nil)
	f.stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.User{ID: "user-1", SchemaURL: otherSchemaURL}, nil)

	var logged bytes.Buffer
	ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logged, nil)))

	_, err := f.resolver.LoadParked(ctx, loadInput())
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Contains(t, logged.String(), ssoSchemaURL)
	assert.Contains(t, logged.String(), otherSchemaURL)
	assert.NotContains(t, err.Error(), ssoSchemaURL)
	assert.NotContains(t, err.Error(), otherSchemaURL)
}

func TestFlowSSOIdentityResolver_BindLinked_WritesBothFactorsAndDeletes(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	gomock.InOrder(
		f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil),
		f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil),
	)
	var written []domain.AuthFactor
	record := func(_ context.Context, _, _ string, factor domain.AuthFactor) (string, error) {
		written = append(written, factor)
		return "ch-new", nil
	}
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).DoAndReturn(record)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).DoAndReturn(record)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).Times(2)

	err := f.resolver.BindLinked(t.Context(), domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-1", ConnectionID: "idp-1", LinkID: "idplink-1",
	})
	require.NoError(t, err)
	assert.Equal(t, []domain.AuthFactor{
		&domain.AuthFactorUser{UserID: "user-1"},
		&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-1", AttemptID: ssoAttemptID},
	}, written)
}

// The parked row was settled by a concurrent request or replaced by a new
// ceremony: nothing is written and the error reaches the engine as is.
func TestFlowSSOIdentityResolver_BindLinked_StaleRowAbortsBeforeWrites(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(domain.ErrSSOStateInvalid())
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindLinked(t.Context(), domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-1", ConnectionID: "idp-1", LinkID: "idplink-1",
	})
	require.ErrorIs(t, err, domain.ErrSSOStateInvalid())
}

func TestFlowSSOIdentityResolver_BindLinked_RefusesDifferentBoundUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-a"}), nil)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	// Deleted first, then rolled back with the transaction.
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)

	err := f.resolver.BindLinked(t.Context(), domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-b", ConnectionID: "idp-1", LinkID: "idplink-1",
	})
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// A concurrent identifier submission bound a user between the read and the
// write: the add is refused and the flow restarts. There is no re-read, because
// on Spanner the refused insert has already ended the transaction.
func TestFlowSSOIdentityResolver_BindLinked_ConcurrentBindRestartsWithoutReread(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	gomock.InOrder(
		// Deleted first, then rolled back with the transaction.
		f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil),
		f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil).Times(1),
		f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).
			Return("", database.NewUniqueError("checks", "", nil)),
	)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindLinked(t.Context(), domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-1", ConnectionID: "idp-1", LinkID: "idplink-1",
	})
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// The attempt already carries this user (the identifier step resolved the same
// account the provider links to): the user factor is kept as it is, and only
// the sso factor is written.
func TestFlowSSOIdentityResolver_BindLinked_SameUserAlreadyBoundSkipsUserFactor(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	gomock.InOrder(
		f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil),
		f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
			Return(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-1"}), nil),
	)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID,
		&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-1", AttemptID: ssoAttemptID}).Return("ch-sso", nil)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).Times(1)

	err := f.resolver.BindLinked(t.Context(), domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-1", ConnectionID: "idp-1", LinkID: "idplink-1",
	})
	require.NoError(t, err)
}

// The pinned revision (or its connection) was deleted while the user was at
// the provider: the flow cannot resolve the identity and must be restarted.
func TestFlowSSOIdentityResolver_LoadParked_RevisionMissingRestarts(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), ssoProjectID, ssoRevisionID).Return(nil, domain.ErrIDPConnectionNotFound())

	var logged bytes.Buffer
	ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logged, nil)))

	_, err := f.resolver.LoadParked(ctx, loadInput())
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Contains(t, logged.String(), ssoProjectID)
	assert.Contains(t, logged.String(), ssoRevisionID)
}

// ssoUserSchema is the schema CreateLinked validates the claims against.
const ssoUserSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"required": ["email"],
	"properties": {
		"email": {"type": "string", "format": "email", "x-unique": "project"}
	}
}`

func createInput() domain.FlowSSOCreateInput {
	return domain.FlowSSOCreateInput{
		ProjectID:     ssoProjectID,
		AttemptID:     ssoAttemptID,
		CheckID:       "ch-1",
		UserSchemaURL: ssoSchemaURL,
		ConnectionID:  "idp-1",
		Subject:       "sub-1",
		Attributes:    map[string]any{"email": "alice@example.com"},
	}
}

// expectCreateUser wires the user half of CreateLinked: the minted id, the
// schema read and the user insert.
func (f *ssoResolverFixture) expectCreateUser(createErr error) {
	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_new", nil)
	f.schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), ssoProjectID, ssoSchemaURL).
		Return(&domain.JSONSchema{ProjectID: ssoProjectID, URL: ssoSchemaURL, Schema: []byte(ssoUserSchema)}, nil)
	f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).Return(createErr)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
		f.events = append(f.events, ev)
		return nil
	}).AnyTimes()
}

func TestFlowSSOIdentityResolver_CreateLinked_AppliesActionsInOneTransaction(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.expectCreateUser(nil)
	var created *domain.IDPIdentityLink
	f.stmts.EXPECT().CreateIDPIdentityLink(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, link *domain.IDPIdentityLink) error {
			link.ID = "idplink-new"
			created = link
			return nil
		})
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil)
	var written []domain.AuthFactor
	record := func(_ context.Context, _, _ string, factor domain.AuthFactor) (string, error) {
		written = append(written, factor)
		return "ch-new", nil
	}
	// The exact parked row goes first, then the user factor is added (refused
	// when one is stored) and the sso factor set.
	gomock.InOrder(
		f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil),
		f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).DoAndReturn(record),
		f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).DoAndReturn(record),
	)

	userID, err := f.resolver.CreateLinked(t.Context(), createInput())
	require.NoError(t, err)
	assert.Equal(t, "user_new", userID)
	assert.Equal(t, &domain.IDPIdentityLink{ProjectID: ssoProjectID, ID: "idplink-new", ConnectionID: "idp-1", Subject: "sub-1", UserID: "user_new"}, created)
	assert.Equal(t, []domain.AuthFactor{
		&domain.AuthFactorUser{UserID: "user_new"},
		&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-new", AttemptID: ssoAttemptID},
	}, written, "the sso factor carries the link id the insert minted")
}

func TestFlowSSOIdentityResolver_CreateLinked_UniqueErrorMapsToUserAlreadyExists(t *testing.T) {
	t.Parallel()
	for name, wire := range map[string]func(f *ssoResolverFixture){
		"user": func(f *ssoResolverFixture) {
			f.expectCreateUser(database.NewUniqueError("users", "uq", nil))
		},
		"link": func(f *ssoResolverFixture) {
			f.expectCreateUser(nil)
			f.stmts.EXPECT().CreateIDPIdentityLink(gomock.Any(), gomock.Any()).
				Return(database.NewUniqueError("idp_identity_links", "uq_idp_identity_links_connection_subject", nil))
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.inTransaction(t)
			wire(f)
			f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
			f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
			f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

			_, err := f.resolver.CreateLinked(t.Context(), createInput())
			require.ErrorIs(t, err, domain.ErrUserAlreadyExists())
		})
	}
}

func TestFlowSSOIdentityResolver_CreateLinked_RefusesBoundAttempt(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.expectCreateUser(nil)
	f.expectLinkCreated()
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-a"}), nil)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	_, err := f.resolver.CreateLinked(t.Context(), createInput())
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// With no project-unique claim nothing probed the attempt before the create,
// so the bind is the first place that sees an expired attempt. It refuses, and
// the user and link roll back with it.
func TestFlowSSOIdentityResolver_CreateLinked_RefusesExpiredAttempt(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.expectCreateUser(nil)
	f.expectLinkCreated()
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	ttl := time.Minute
	expired := parkedAttempt(parkedResult())
	expired.CreatedAt = time.Now().Add(-time.Hour)
	expired.TimeToLive = &ttl
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(expired, nil)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	_, err := f.resolver.CreateLinked(t.Context(), createInput())
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

func TestFlowSSOIdentityResolver_BindLinked_RefusesHandedOffAttempt(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	handedOff := parkedAttempt(parkedResult())
	handedOff.HandoffToken = &domain.HandoffToken{}
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(handedOff, nil)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindLinked(t.Context(), domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-1", ConnectionID: "idp-1", LinkID: "idplink-1",
	})
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// A lost attribute race is a failed user creation, audited like one created
// through the user API.
func TestFlowSSOIdentityResolver_CreateLinked_LostRaceEmitsUserCreateFailed(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.expectCreateUser(database.NewUniqueError("users", "uq_unique_attributes", nil))

	_, err := f.resolver.CreateLinked(t.Context(), createInput())
	require.ErrorIs(t, err, domain.ErrUserAlreadyExists())
	assert.NotNil(t, f.event(domain.EventTypeUserCreateFailed))
}

func TestFlowSSOIdentityResolver_FindUniqueOwner(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		user    *domain.User
		err     error
		want    string
		wantErr bool
	}{
		"hit":   {user: &domain.User{ID: "user-9"}, want: "user-9"},
		"miss":  {err: database.NewNoRowFoundError(nil)},
		"error": {err: errors.New("boom"), wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.stmts.EXPECT().
				GetUser(gomock.Any(), gomock.Any(), service.UserQueryOptions{
					Attributes:           []domain.Attribute{{Key: "email", Value: "alice@example.com"}},
					UniqueAttributesOnly: true,
					// Project-scoped rows only: a team-scoped row for the
					// same value would not collide with the new user.
					UniqueTeamID: new(""),
				}).
				Return(tc.user, tc.err)

			got, err := f.resolver.FindUniqueOwner(t.Context(), ssoProjectID, "email", "alice@example.com")
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

// A parked row the engine already resolved (sso_user_not_found leaves it in
// place) is skipped before the revision and link reads.
func TestFlowSSOIdentityResolver_LoadParked_AlreadyResolvedSkipsReads(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Times(0)

	in := loadInput()
	in.ResolvedCheckID = "ch-1"
	got, err := f.resolver.LoadParked(t.Context(), in)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func expiredAttempt(a *domain.AuthAttempt) *domain.AuthAttempt {
	ttl := time.Minute
	a.CreatedAt = time.Now().Add(-time.Hour)
	a.TimeToLive = &ttl
	return a
}

// A dead attempt cannot settle a parked identity, whichever branch would run.
func TestFlowSSOIdentityResolver_LoadParked_ExpiredAttemptWithParkedRowRestarts(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(expiredAttempt(parkedAttempt(parkedResult())), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	_, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// The replay shortcut would hide a dead attempt on every later render, so the
// state check runs before it.
func TestFlowSSOIdentityResolver_LoadParked_HandedOffAttemptRestartsBeforeReplayShortcut(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	handedOff := parkedAttempt(parkedResult())
	handedOff.HandoffToken = &domain.HandoffToken{}
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(handedOff, nil)

	in := loadInput()
	in.ResolvedCheckID = "ch-1"
	_, err := f.resolver.LoadParked(t.Context(), in)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// Without an SSO row there is nothing to resolve, and a plain render of a
// flow with a dead attempt keeps its behaviour.
func TestFlowSSOIdentityResolver_LoadParked_DeadAttemptWithoutSSORowIsNil(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(expiredAttempt(&domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID}), nil)

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	assert.Nil(t, got)
}

// event returns the first inserted event of eventType, or nil.
func (f *ssoResolverFixture) event(eventType domain.EventType) *domain.Event {
	for _, ev := range f.events {
		if ev.EventType == eventType {
			return ev
		}
	}
	return nil
}

// The link is a new mutation, audited in the same transaction. Its payload
// holds ids only: the provider's subject and claims never reach the trail.
func TestFlowSSOIdentityResolver_CreateLinked_EmitsIdentityLinkCreated(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.expectCreateUser(nil)
	f.stmts.EXPECT().CreateIDPIdentityLink(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, link *domain.IDPIdentityLink) error {
			link.ID = "idplink-new"
			return nil
		})
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).Return("ch-user", nil)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).Return("ch-sso", nil)

	_, err := f.resolver.CreateLinked(t.Context(), createInput())
	require.NoError(t, err)

	ev := f.event(domain.EventTypeIDPIdentityLinkCreated)
	require.NotNil(t, ev)
	assert.Equal(t, domain.EventCategoryEntity, ev.Category)
	assert.Equal(t, "idp_identity_link", *ev.EntityType)
	assert.Equal(t, "idplink-new", *ev.EntityID)
	assert.JSONEq(t, `{"connection_id":"idp-1","user_id":"user_new"}`, string(ev.Payload))
	assert.NotContains(t, string(ev.Payload), "sub-1")
}

func collisionInput(userID string) domain.FlowSSOBindInput {
	return domain.FlowSSOBindInput{ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: userID}
}

// A collision binds the found owner the way a typed identifier would: a user
// factor alone, no link and no sso factor. The parked row is touched, not
// deleted, so a retry after a lost cookie finds it and raises the outcome
// again.
func TestFlowSSOIdentityResolver_BindCollision_WritesUserFactorOnlyAndKeepsRow(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	var written []domain.AuthFactor
	gomock.InOrder(
		f.stmts.EXPECT().TouchSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil),
		f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil),
		f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).
			DoAndReturn(func(_ context.Context, _, _ string, factor domain.AuthFactor) (string, error) {
				written = append(written, factor)
				return "ch-user", nil
			}),
	)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil)
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	require.NoError(t, f.resolver.BindCollision(t.Context(), collisionInput("user-9")))
	assert.Equal(t, []domain.AuthFactor{&domain.AuthFactorUser{UserID: "user-9"}}, written)
}

func TestFlowSSOIdentityResolver_BindCollision_StaleRowAbortsBeforeWrites(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().TouchSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(domain.ErrSSOStateInvalid())
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindCollision(t.Context(), collisionInput("user-9"))
	require.ErrorIs(t, err, domain.ErrSSOStateInvalid())
}

func TestFlowSSOIdentityResolver_BindCollision_RefusesDifferentBoundUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().TouchSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-a"}), nil)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindCollision(t.Context(), collisionInput("user-9"))
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// expectLinkCreated mints the link id the way the statement does.
func (f *ssoResolverFixture) expectLinkCreated() {
	f.stmts.EXPECT().CreateIDPIdentityLink(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, link *domain.IDPIdentityLink) error {
			link.ID = "idplink-new"
			return nil
		})
}

// The attempt already carries this user (a retry after a lost cookie): the
// bind is idempotent and skips the add. On Spanner a refused add poisons the
// transaction, so the re-read after it could never run.
func TestFlowSSOIdentityResolver_BindCollision_SameUserAlreadyBoundSkipsAdd(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().TouchSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-9"}), nil)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Times(0)

	require.NoError(t, f.resolver.BindCollision(t.Context(), collisionInput("user-9")))
}

// A user factor next to a still-parked row this flow already resolved comes
// from a collision bind (the linked and created paths delete the row). It is
// reported, so a flow whose cookie lost that bind can catch up, and nothing
// else is read.
func TestFlowSSOIdentityResolver_LoadParked_ResolvedRowWithUserFactorReportsCollisionUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "u-b"}), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Times(0)

	in := loadInput()
	in.ResolvedCheckID = "ch-1"
	got, err := f.resolver.LoadParked(t.Context(), in)
	require.NoError(t, err)
	assert.Equal(t, &domain.FlowSSOParkedIdentity{CollisionUserID: "u-b", AttemptUserID: "u-b"}, got)
}

func TestFlowSSOIdentityResolver_LoadParked_ResolvedRowWithoutUserFactorIsNil(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(parkedAttempt(parkedResult()), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	in := loadInput()
	in.ResolvedCheckID = "ch-1"
	got, err := f.resolver.LoadParked(t.Context(), in)
	require.NoError(t, err)
	assert.Nil(t, got)
}

// The user the attempt already carries (a signed-in session copies its user
// in) is reported, so the engine can refuse to collect or create on it.
func TestFlowSSOIdentityResolver_LoadParked_ReportsAttemptUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "u-s"}), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), ssoProjectID, ssoRevisionID).
		Return(&domain.IDPConnection{ProjectID: ssoProjectID, ID: "idp-1", RevisionID: ssoRevisionID, Document: []byte(ssoConnectionDocument)}, nil)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "u-s", got.AttemptUserID)
}
