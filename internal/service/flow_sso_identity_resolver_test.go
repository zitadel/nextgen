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

// ssoResolverConnectionDocument is a minimal connection revision the engine parses.
const ssoResolverConnectionDocument = `{
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

// ssoUserSchema is the schema CreateLinked validates the claims against.
const ssoUserSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"required": ["email"],
	"properties": {
		"email": {"type": "string", "format": "email", "x-unique": "project"}
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

func (f *ssoResolverFixture) expectAttempt(attempt *domain.AuthAttempt) *servicemocks.MockAllStatementsGetAuthAttemptByIDCall {
	return f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(attempt, nil)
}

func (f *ssoResolverFixture) expectRevision() {
	f.connections.EXPECT().GetRevision(gomock.Any(), ssoProjectID, ssoRevisionID).
		Return(&domain.IDPConnection{ProjectID: ssoProjectID, ID: "idp-1", RevisionID: ssoRevisionID, Document: []byte(ssoResolverConnectionDocument)}, nil)
}

func (f *ssoResolverFixture) expectNoRevisionOrLinkRead() {
	f.connections.EXPECT().GetRevision(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Times(0)
}

func (f *ssoResolverFixture) expectNoFactorWrites() {
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
}

// expectParked wires the reads LoadParked makes up to the link lookup.
func (f *ssoResolverFixture) expectParked(attempt *domain.AuthAttempt, link *domain.IDPIdentityLink, linkErr error) {
	f.expectAttempt(attempt)
	f.expectRevision()
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Return(link, linkErr)
}

// expectCreateUser wires the user half of CreateLinked: the minted id, the
// schema read and the user insert. It returns the insert for ordering.
func (f *ssoResolverFixture) expectCreateUser(createErr error) *servicemocks.MockAllStatementsCreateUserCall {
	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_new", nil)
	f.schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), ssoProjectID, ssoSchemaURL).
		Return(&domain.JSONSchema{ProjectID: ssoProjectID, URL: ssoSchemaURL, Schema: []byte(ssoUserSchema)}, nil)
	createUser := f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).Return(createErr)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
		f.events = append(f.events, ev)
		return nil
	}).AnyTimes()
	return createUser
}

// expectLinkCreated mints the link id the way the statement does.
func (f *ssoResolverFixture) expectLinkCreated() *servicemocks.MockAllStatementsCreateIDPIdentityLinkCall {
	return f.stmts.EXPECT().CreateIDPIdentityLink(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, link *domain.IDPIdentityLink) error {
			link.ID = "idplink-new"
			return nil
		})
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

// boundAttempt carries the factors a BindLinked wrote, with the parked row
// already deleted.
func boundAttempt() *domain.AuthAttempt {
	return &domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: boundFactors()}
}

func boundFactors() []domain.AuthCheck {
	return []domain.AuthCheck{
		&domain.AuthFactorUser{UserID: "user-1"},
		&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-1", AttemptID: ssoAttemptID},
	}
}

func expiredAttempt(a *domain.AuthAttempt) *domain.AuthAttempt {
	ttl := time.Minute
	a.CreatedAt = time.Now().Add(-time.Hour)
	a.TimeToLive = &ttl
	return a
}

func handedOffAttempt(a *domain.AuthAttempt) *domain.AuthAttempt {
	a.HandoffToken = &domain.HandoffToken{}
	return a
}

func loadInput() domain.FlowSSOLoadInput {
	return domain.FlowSSOLoadInput{ProjectID: ssoProjectID, AttemptID: ssoAttemptID, UserSchemaURL: ssoSchemaURL}
}

func collectedInput() domain.FlowSSOLoadInput {
	in := loadInput()
	in.ResolvedCheckID = "ch-1"
	return in
}

func bindInput() domain.FlowSSOBindInput {
	return domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-1", ConnectionID: "idp-1", LinkID: "idplink-1",
	}
}

func collisionInput(userID string) domain.FlowSSOBindInput {
	return domain.FlowSSOBindInput{ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: userID}
}

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

func TestFlowSSOIdentityResolver_LoadParked_NothingToResolveIsNil(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		attempt    *domain.AuthAttempt
		resolvedID string
	}{
		"no sso row":        {attempt: &domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID}},
		"row still pending": {attempt: parkedAttempt(nil)},
		// A new attempt started from an SSO session inherits the session's
		// factors, including an sso factor another attempt wrote: that is no
		// lost settlement.
		"session-copied sso factor": {attempt: &domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: []domain.AuthCheck{
			&domain.AuthFactorUser{UserID: "user-1"},
			&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-1", AttemptID: "att-earlier"},
		}}},
		// A row the engine already resolved (sso_user_not_found, creation
		// disabled or a parked error leaves it parked) is skipped before the
		// revision and link reads.
		"already resolved row":       {attempt: parkedAttempt(parkedResult()), resolvedID: "ch-1"},
		"already resolved error row": {attempt: parkedAttempt(&domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed}), resolvedID: "ch-1"},
		// An earlier bind lost its handoff, then a second ceremony parked a row
		// the engine already resolved: the row still wins, so the earlier user
		// is not signed in.
		"bound attempt with resolved row": {attempt: parkedAttempt(parkedResult(), boundFactors()...), resolvedID: "ch-1"},
		// A user factor without the marker (an identifier a concurrent request
		// submitted after collection, say) is not a collision.
		"resolved row with unrelated user factor": {attempt: parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "u-x"}), resolvedID: "ch-1"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.expectAttempt(tc.attempt)
			f.expectNoRevisionOrLinkRead()

			in := loadInput()
			in.ResolvedCheckID = tc.resolvedID
			got, err := f.resolver.LoadParked(t.Context(), in)
			require.NoError(t, err)
			assert.Nil(t, got)
		})
	}
}

// A previous request bound the attempt and deleted the parked row, then lost
// its handoff: the bound user is reported so the handoff can be retried.
func TestFlowSSOIdentityResolver_LoadParked_BoundAttemptReportsUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectAttempt(boundAttempt())
	f.expectNoRevisionOrLinkRead()

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	assert.Equal(t, &domain.FlowSSOParkedIdentity{BoundUserID: "user-1", AttemptUserID: "user-1"}, got)
}

func TestFlowSSOIdentityResolver_LoadParked_BoundAttemptWithParkedResultPrefersResult(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectParked(parkedAttempt(parkedResult(), boundFactors()...), nil, database.NewNoRowFoundError(nil))

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "ch-1", got.CheckID)
	assert.Empty(t, got.BoundUserID)
}

// A dead attempt can neither settle a parked identity nor hand off again, so a
// load with an older cookie restarts instead of rendering a step whose next
// submission fails.
func TestFlowSSOIdentityResolver_LoadParked_DeadAttemptRestarts(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		attempt    *domain.AuthAttempt
		resolvedID string
	}{
		"bound and handed off": {attempt: handedOffAttempt(boundAttempt())},
		"bound and expired":    {attempt: expiredAttempt(boundAttempt())},
		"parked and expired":   {attempt: expiredAttempt(parkedAttempt(parkedResult()))},
		// The replay shortcut would hide a dead attempt on every later render,
		// so the state check runs before it.
		"handed off with resolved row": {attempt: handedOffAttempt(parkedAttempt(parkedResult())), resolvedID: "ch-1"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.expectAttempt(tc.attempt)
			f.expectNoRevisionOrLinkRead()

			in := loadInput()
			in.ResolvedCheckID = tc.resolvedID
			_, err := f.resolver.LoadParked(t.Context(), in)
			require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
		})
	}
}

// An error result carries no identity: the key is reported as it is, and the
// pinned revision is never read.
func TestFlowSSOIdentityResolver_LoadParked_ErrorResultReportsKey(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectAttempt(parkedAttempt(&domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOCancelled}))
	f.expectNoRevisionOrLinkRead()

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	assert.Equal(t, &domain.FlowSSOParkedIdentity{CheckID: "ch-1", ErrorKey: domain.FlowStepErrorSSOCancelled}, got)
}

func TestFlowSSOIdentityResolver_LoadParked_LinkFound(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectParked(parkedAttempt(parkedResult()), &domain.IDPIdentityLink{ID: "idplink-1", ConnectionID: "idp-1", Subject: "sub-1", UserID: "user-1"}, nil)
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
	f.expectParked(parkedAttempt(parkedResult()), nil, database.NewNoRowFoundError(nil))

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
	f.expectParked(parkedAttempt(parkedResult()), &domain.IDPIdentityLink{ID: "idplink-1", UserID: "user-1"}, nil)
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

// The user the attempt already carries (a signed-in session copies its user
// in) is reported, so the engine can refuse to collect or create on it.
func TestFlowSSOIdentityResolver_LoadParked_ReportsAttemptUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectParked(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "u-s"}), nil, database.NewNoRowFoundError(nil))

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "u-s", got.AttemptUserID)
}

// A collision bind replaces the parked row with a marker of the user it bound.
// The marker is reported, so a flow whose cookie lost the bind can catch up,
// and nothing else is read: the marker carries no revision to read.
func TestFlowSSOIdentityResolver_LoadParked_CollisionMarkerReportsCollisionUser(t *testing.T) {
	t.Parallel()
	marked := parkedResult()
	marked.CollisionUserID = "u-b"
	for name, tc := range map[string]struct {
		result     *domain.SSOCallbackResult
		resolvedID string
	}{
		"resolved row": {result: marked, resolvedID: "ch-1"},
		// The cookie that lost the race recorded no resolved id.
		"no resolved id": {result: &domain.SSOCallbackResult{CollisionUserID: "u-b"}},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.expectAttempt(parkedAttempt(tc.result, &domain.AuthFactorUser{UserID: "u-b"}))
			f.expectNoRevisionOrLinkRead()

			in := loadInput()
			in.ResolvedCheckID = tc.resolvedID
			got, err := f.resolver.LoadParked(t.Context(), in)
			require.NoError(t, err)
			assert.Equal(t, &domain.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, got)
		})
	}
}

// The pinned revision (or its connection) was deleted while the user was at
// the provider: the flow cannot resolve the identity and must be restarted.
func TestFlowSSOIdentityResolver_RevisionMissingRestarts(t *testing.T) {
	t.Parallel()
	type load func(*service.FlowSSOIdentityResolver, context.Context, domain.FlowSSOLoadInput) (*domain.FlowSSOParkedIdentity, error)
	for name, tc := range map[string]struct {
		load load
		in   domain.FlowSSOLoadInput
	}{
		"LoadParked":    {load: (*service.FlowSSOIdentityResolver).LoadParked, in: loadInput()},
		"LoadCollected": {load: (*service.FlowSSOIdentityResolver).LoadCollected, in: collectedInput()},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.expectAttempt(parkedAttempt(parkedResult()))
			f.connections.EXPECT().GetRevision(gomock.Any(), ssoProjectID, ssoRevisionID).Return(nil, domain.ErrIDPConnectionNotFound())

			var logged bytes.Buffer
			ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logged, nil)))

			_, err := tc.load(f.resolver, ctx, tc.in)
			require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
			assert.Contains(t, logged.String(), ssoProjectID)
			assert.Contains(t, logged.String(), ssoRevisionID)
		})
	}
}

// The row the engine resolved and left parked for collection is read again,
// without the link lookup LoadParked makes.
func TestFlowSSOIdentityResolver_LoadCollected_ReadsResolvedRow(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectAttempt(parkedAttempt(parkedResult()))
	f.expectRevision()
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Times(0)

	got, err := f.resolver.LoadCollected(t.Context(), collectedInput())
	require.NoError(t, err)
	assert.Equal(t, &domain.FlowSSOParkedIdentity{
		CheckID:      "ch-1",
		ConnectionID: "idp-1",
		Subject:      "sub-1",
		Claims:       map[string]any{"email": "alice@example.com"},
		Verified:     map[string]bool{"email": true},
	}, got)
}

func TestFlowSSOIdentityResolver_LoadCollected_NothingToCollectIsNil(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		attempt    *domain.AuthAttempt
		resolvedID string
	}{
		"no sso row":        {attempt: &domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID}, resolvedID: "ch-1"},
		"row still pending": {attempt: parkedAttempt(nil), resolvedID: "ch-1"},
		"newer row":         {attempt: parkedAttempt(parkedResult()), resolvedID: "ch-0"},
		"collision marker":  {attempt: parkedAttempt(&domain.SSOCallbackResult{CollisionUserID: "u-b"}), resolvedID: "ch-1"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.expectAttempt(tc.attempt)
			f.expectNoRevisionOrLinkRead()

			in := loadInput()
			in.ResolvedCheckID = tc.resolvedID
			got, err := f.resolver.LoadCollected(t.Context(), in)
			require.NoError(t, err)
			assert.Nil(t, got)
		})
	}
}

// A failed ceremony left nothing to create from, so the flow restarts.
func TestFlowSSOIdentityResolver_LoadCollected_ErrorRowRestarts(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.expectAttempt(parkedAttempt(&domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOCancelled}))
	f.expectNoRevisionOrLinkRead()

	_, err := f.resolver.LoadCollected(t.Context(), collectedInput())
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

func TestFlowSSOIdentityResolver_BindLinked_WritesBothFactorsAndDeletes(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	gomock.InOrder(
		f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil),
		f.expectAttempt(parkedAttempt(parkedResult())),
	)
	var written []domain.AuthFactor
	record := func(_ context.Context, _, _ string, factor domain.AuthFactor) (string, error) {
		written = append(written, factor)
		return "ch-new", nil
	}
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).DoAndReturn(record)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).DoAndReturn(record)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).Times(2)

	require.NoError(t, f.resolver.BindLinked(t.Context(), bindInput()))
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
	f.expectNoFactorWrites()

	err := f.resolver.BindLinked(t.Context(), bindInput())
	require.ErrorIs(t, err, domain.ErrSSOStateInvalid())
}

// Nothing is written, and the deleted row rolls back with the transaction.
func TestFlowSSOIdentityResolver_BindLinked_RefusesAttempt(t *testing.T) {
	t.Parallel()
	for name, attempt := range map[string]*domain.AuthAttempt{
		"another user bound": parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-a"}),
		// The attempt expired between the load and the bind.
		"expired":    expiredAttempt(parkedAttempt(parkedResult())),
		"handed off": handedOffAttempt(parkedAttempt(parkedResult())),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.inTransaction(t)
			f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
			f.expectAttempt(attempt)
			f.expectNoFactorWrites()

			err := f.resolver.BindLinked(t.Context(), bindInput())
			require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
		})
	}
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
		f.expectAttempt(parkedAttempt(parkedResult())),
		f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID, gomock.Any()).
			Return("", database.NewUniqueError("checks", "", nil)),
	)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindLinked(t.Context(), bindInput())
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	var refused *database.UniqueError
	assert.ErrorAs(t, err, &refused, "the refused add stays in the chain")
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
		f.expectAttempt(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-1"})),
	)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), ssoProjectID, ssoAttemptID,
		&domain.AuthFactorSSO{ConnectionID: "idp-1", LinkID: "idplink-1", AttemptID: ssoAttemptID}).Return("ch-sso", nil)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).Times(1)

	require.NoError(t, f.resolver.BindLinked(t.Context(), bindInput()))
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
		f.stmts.EXPECT().MarkSSOCallbackCollision(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1", "user-9").Return(nil),
		f.expectAttempt(parkedAttempt(parkedResult())),
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
	f.stmts.EXPECT().MarkSSOCallbackCollision(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1", "user-9").Return(domain.ErrSSOStateInvalid())
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindCollision(t.Context(), collisionInput("user-9"))
	require.ErrorIs(t, err, domain.ErrSSOStateInvalid())
}

func TestFlowSSOIdentityResolver_BindCollision_RefusesDifferentBoundUser(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().MarkSSOCallbackCollision(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1", "user-9").Return(nil)
	f.expectAttempt(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-a"}))
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindCollision(t.Context(), collisionInput("user-9"))
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// The attempt already carries this user (a retry after a lost cookie): the
// bind is idempotent and skips the add. On Spanner a refused add poisons the
// transaction, so the re-read after it could never run.
func TestFlowSSOIdentityResolver_BindCollision_SameUserAlreadyBoundSkipsAdd(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().MarkSSOCallbackCollision(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1", "user-9").Return(nil)
	f.expectAttempt(parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-9"}))
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Times(0)

	require.NoError(t, f.resolver.BindCollision(t.Context(), collisionInput("user-9")))
}

func TestFlowSSOIdentityResolver_CreateLinked_AppliesActionsInOneTransaction(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	var created *domain.IDPIdentityLink
	f.expectAttempt(parkedAttempt(parkedResult()))
	var written []domain.AuthFactor
	record := func(_ context.Context, _, _ string, factor domain.AuthFactor) (string, error) {
		written = append(written, factor)
		return "ch-new", nil
	}
	// The exact parked row is claimed before the user insert, so a concurrent
	// request on the attempt loses on the row. Then the link, the user factor
	// (refused when one is stored) and the sso factor.
	gomock.InOrder(
		f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil),
		f.expectCreateUser(nil),
		f.stmts.EXPECT().CreateIDPIdentityLink(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, link *domain.IDPIdentityLink) error {
				link.ID = "idplink-new"
				created = link
				return nil
			}),
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
			f.expectNoFactorWrites()
			// The claim runs first and rolls back with the transaction.
			f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)

			_, err := f.resolver.CreateLinked(t.Context(), createInput())
			require.ErrorIs(t, err, domain.ErrUserAlreadyExists())
		})
	}
}

// The bind refuses after the user and link inserts, and both roll back with
// it.
func TestFlowSSOIdentityResolver_CreateLinked_RefusesAttempt(t *testing.T) {
	t.Parallel()
	for name, attempt := range map[string]*domain.AuthAttempt{
		"another user bound": parkedAttempt(parkedResult(), &domain.AuthFactorUser{UserID: "user-a"}),
		// With no project-unique claim nothing probed the attempt before the
		// create, so the bind is the first place that sees an expired attempt.
		"expired": expiredAttempt(parkedAttempt(parkedResult())),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.inTransaction(t)
			f.expectCreateUser(nil)
			f.expectLinkCreated()
			f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
			f.expectAttempt(attempt)
			f.expectNoFactorWrites()

			_, err := f.resolver.CreateLinked(t.Context(), createInput())
			require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
		})
	}
}

// A lost attribute race is a failed user creation, audited like one created
// through the user API.
func TestFlowSSOIdentityResolver_CreateLinked_LostRaceEmitsUserCreateFailed(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	f.expectCreateUser(database.NewUniqueError("users", "uq_unique_attributes", nil))

	_, err := f.resolver.CreateLinked(t.Context(), createInput())
	require.ErrorIs(t, err, domain.ErrUserAlreadyExists())
	assert.NotNil(t, f.event(domain.EventTypeUserCreateFailed))
}

// A concurrent request on the same attempt settled the parked row first. The
// claim refuses before the user insert, so the engine reads the attempt again
// instead of taking the collision path, and no failed creation is audited.
func TestFlowSSOIdentityResolver_CreateLinked_SettledRowWritesNothing(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_new", nil)
	f.schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), ssoProjectID, ssoSchemaURL).
		Return(&domain.JSONSchema{ProjectID: ssoProjectID, URL: ssoSchemaURL, Schema: []byte(ssoUserSchema)}, nil)
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(domain.ErrSSOStateInvalid())
	f.stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().CreateIDPIdentityLink(gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Times(0)

	_, err := f.resolver.CreateLinked(t.Context(), createInput())
	require.ErrorIs(t, err, domain.ErrSSOStateInvalid())
}

// The link is a new mutation, audited in the same transaction. Its payload
// holds ids only: the provider's subject and claims never reach the trail.
func TestFlowSSOIdentityResolver_CreateLinked_EmitsIdentityLinkCreated(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.expectCreateUser(nil)
	f.expectLinkCreated()
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	f.expectAttempt(parkedAttempt(parkedResult()))
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

func TestFlowSSOIdentityResolver_FindUniqueOwner(t *testing.T) {
	t.Parallel()
	boom := errors.New("boom")
	for name, tc := range map[string]struct {
		user    *domain.User
		err     error
		want    string
		wantErr error
	}{
		"hit":  {user: &domain.User{ID: "user-9", SchemaURL: ssoSchemaURL}, want: "user-9"},
		"miss": {err: database.NewNoRowFoundError(nil)},
		// The registry key has no schema: the value can belong to a user of
		// another schema that also marks the property project-unique.
		"owner of another schema": {
			user:    &domain.User{ID: "user-9", SchemaURL: "https://example.test/user/v1/other.user.schema.json"},
			wantErr: domain.ErrFlowRestartRequired(),
		},
		"error": {err: boom, wantErr: boom},
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

			got, err := f.resolver.FindUniqueOwner(t.Context(), ssoProjectID, ssoSchemaURL, "email", "alice@example.com")
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}
