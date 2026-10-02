package service_test

import (
	"bytes"
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
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

type ssoResolverFixture struct {
	pool        *servicemocks.MockStatementPool
	stmts       *servicemocks.MockAllStatements
	connections *servicemocks.MockIDPConnectionService
	resolver    *service.FlowSSOIdentityResolver
}

func newSSOResolverFixture(t *testing.T) *ssoResolverFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	return &ssoResolverFixture{
		pool:        pool,
		stmts:       stmts,
		connections: connections,
		resolver:    service.NewFlowSSOIdentityResolver(pool, connections),
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
		Return(&domain.IDPConnection{ProjectID: ssoProjectID, ID: "idp-1", RevisionID: ssoRevisionID, Document: []byte(ssoResolverConnectionDocument)}, nil)
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
	assert.Equal(t, &domain.FlowSSOParkedIdentity{BoundUserID: "user-1"}, got)
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
		Return(&domain.IDPConnection{ProjectID: ssoProjectID, ID: "idp-1", RevisionID: ssoRevisionID, Document: []byte(ssoResolverConnectionDocument)}, nil)
	f.stmts.EXPECT().GetIDPIdentityLink(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))

	got, err := f.resolver.LoadParked(t.Context(), loadInput())
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "ch-1", got.CheckID)
	assert.Empty(t, got.BoundUserID)
}

// A bound attempt that was handed off, or expired, cannot hand off again: a
// load with an older cookie restarts instead of rendering a step whose next
// submission fails.
func TestFlowSSOIdentityResolver_LoadParked_DeadBoundAttemptRestarts(t *testing.T) {
	t.Parallel()
	handedOff := &domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: boundFactors()}
	handedOff.HandoffToken = &domain.HandoffToken{}
	for name, attempt := range map[string]*domain.AuthAttempt{
		"handed off": handedOff,
		"expired":    expiredAttempt(&domain.AuthAttempt{ProjectID: ssoProjectID, ID: ssoAttemptID, Checks: boundFactors()}),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newSSOResolverFixture(t)
			f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(attempt, nil)

			_, err := f.resolver.LoadParked(t.Context(), loadInput())
			require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
		})
	}
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

// The attempt expired between the load and the bind: nothing is written, and
// the deleted row rolls back with the transaction.
func TestFlowSSOIdentityResolver_BindLinked_RefusesExpiredAttempt(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.inTransaction(t)
	f.stmts.EXPECT().DeleteSSOCallback(gomock.Any(), ssoProjectID, ssoAttemptID, "ch-1").Return(nil)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).Return(expiredAttempt(parkedAttempt(parkedResult())), nil)
	f.stmts.EXPECT().AddAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
	f.stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

	err := f.resolver.BindLinked(t.Context(), domain.FlowSSOBindInput{
		ProjectID: ssoProjectID, AttemptID: ssoAttemptID, CheckID: "ch-1", UserID: "user-1", ConnectionID: "idp-1", LinkID: "idplink-1",
	})
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// A parked row the engine already resolved (creation disabled leaves it
// parked) is skipped before the revision and link reads.
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

// An earlier bind lost its handoff, then a second ceremony parked a row the
// engine already resolved: the row still wins, so the earlier user is not
// signed in.
func TestFlowSSOIdentityResolver_LoadParked_BoundAttemptWithResolvedRowIsNil(t *testing.T) {
	t.Parallel()
	f := newSSOResolverFixture(t)
	f.stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), ssoProjectID, ssoAttemptID).
		Return(parkedAttempt(parkedResult(), boundFactors()...), nil)
	f.connections.EXPECT().GetRevision(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

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
