package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const ensureTestPlatform = "proj_platform"

// stubIdentity satisfies [service.UserIdentityReader] without mockgen — the
// interface is one method, and the ensure only reads the email from it.
type stubIdentity struct {
	user *domain.User
	err  error
}

func (s stubIdentity) GetIdentity(_ context.Context, _, _ string, _ ...string) (*domain.User, error) {
	return s.user, s.err
}

type ensureFixture struct {
	ensurer service.PersonalTeamEnsurer
	v2Pool  *servicemocks.MockPool
	stmts   *servicemocks.MockAllStatements
}

func newEnsureFixture(t *testing.T, users service.UserIdentityReader) *ensureFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	v2Pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	v2Pool.EXPECT().Statements().Return(stmts).AnyTimes()

	return &ensureFixture{
		ensurer: service.NewPersonalTeamService(service.NewPool(v2Pool), users, ensureTestPlatform),
		v2Pool:  v2Pool,
		stmts:   stmts,
	}
}

func emailIdentity(email string) stubIdentity {
	return stubIdentity{user: &domain.User{
		Attributes: domain.AttributesFromMap(map[string]any{"email": email}),
	}}
}

func expectEnsureTx(f *ensureFixture) {
	f.v2Pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{stmts: f.stmts})
		})
}

func TestEnsurePersonalTeam_NoOpOutsidePlatformProject(t *testing.T) {
	// Every registration in every customer project passes through the same
	// funnel; none of those may mint teams — and none may even be read.
	f := newEnsureFixture(t, stubIdentity{})

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), "proj_customer", "user_1"))
}

func TestEnsurePersonalTeam_NoOpWhenUnconfigured(t *testing.T) {
	// An empty platform id — the wiring's value for every deployment that did
	// not opt in via platform.bootstrap_project — makes the ensure a universal
	// no-op, even for a project that happens to match "".
	ctrl := gomock.NewController(t)
	v2Pool := servicemocks.NewMockPool(ctrl)
	ensurer := service.NewPersonalTeamService(service.NewPool(v2Pool), stubIdentity{}, "")

	require.NoError(t, ensurer.EnsurePersonalTeam(t.Context(), "proj_anything", "user_1"))
	require.NoError(t, ensurer.EnsurePersonalTeam(t.Context(), "", "user_1"))
}

func TestEnsurePersonalTeam_NoOpWhenMembershipExists(t *testing.T) {
	// Idempotency: any earliest active membership IS the personal team —
	// seeded, migrated, or a previous ensure. No transaction is opened.
	f := newEnsureFixture(t, stubIdentity{})
	f.stmts.EXPECT().GetPersonalTeamForUser(gomock.Any(), ensureTestPlatform, "user_1").
		Return(&domain.Team{ProjectID: ensureTestPlatform, ID: "team_existing"}, nil)

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1"))
}

func TestEnsurePersonalTeam_ProvisionsTeamAndMembershipTogether(t *testing.T) {
	f := newEnsureFixture(t, emailIdentity("maya@acme.com"))
	f.stmts.EXPECT().GetPersonalTeamForUser(gomock.Any(), ensureTestPlatform, "user_1").
		Return(nil, database.NewNoRowFoundError(nil))

	var team *domain.Team
	var membership *domain.TeamMembership
	f.stmts.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, tm *domain.Team) error {
			// The statement mints the id; the membership below must see it.
			tm.ID = "team_minted"
			team = tm
			return nil
		})
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	f.stmts.EXPECT().CreateTeamMembership(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m *domain.TeamMembership) error {
			membership = m
			return nil
		})
	expectEnsureTx(f)

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1"))

	require.NotNil(t, team)
	// The registration identifier is the display name — and, being unique per
	// project, what makes concurrent ensures collide instead of duplicating.
	assert.Equal(t, "maya@acme.com", team.Name)
	require.NotNil(t, membership)
	assert.Equal(t, "team_minted", membership.TeamID, "membership must join the team minted in the same transaction")
	assert.Equal(t, "user_1", membership.UserID)
	assert.Equal(t, domain.MembershipStatusActive, membership.Status)
}

func TestEnsurePersonalTeam_FallsBackToUserIDNameWhenEmailUnreadable(t *testing.T) {
	// The fallback stays deterministic and collision-free — determinism is
	// what the concurrent-ensure arbitration below relies on.
	f := newEnsureFixture(t, stubIdentity{err: errors.New("identity unavailable")})
	f.stmts.EXPECT().GetPersonalTeamForUser(gomock.Any(), ensureTestPlatform, "user_1").
		Return(nil, database.NewNoRowFoundError(nil))

	var team *domain.Team
	f.stmts.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, tm *domain.Team) error {
			team = tm
			return nil
		})
	f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	f.stmts.EXPECT().CreateTeamMembership(gomock.Any(), gomock.Any()).Return(nil)
	expectEnsureTx(f)

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1"))
	require.NotNil(t, team)
	assert.Equal(t, "Personal user_1", team.Name)
}

func TestEnsurePersonalTeam_LostRaceConvergesOnTheWinner(t *testing.T) {
	// Registration racing the first sign-in: both pass the membership check,
	// the loser's CreateTeam hits the deterministic name's unique constraint.
	// The winner committed team AND membership together, so the re-check
	// confirms convergence instead of assuming it.
	f := newEnsureFixture(t, emailIdentity("maya@acme.com"))
	first := f.stmts.EXPECT().GetPersonalTeamForUser(gomock.Any(), ensureTestPlatform, "user_1").
		Return(nil, database.NewNoRowFoundError(nil))
	f.stmts.EXPECT().GetPersonalTeamForUser(gomock.Any(), ensureTestPlatform, "user_1").
		Return(&domain.Team{ProjectID: ensureTestPlatform, ID: "team_winner"}, nil).
		After(first)

	f.stmts.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).
		Return(database.NewUniqueError("teams", "uq_teams_project_name", nil))
	expectEnsureTx(f)

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1"))
}

// ---- Adapter decoration ------------------------------------------------------

// stubRegisterAttempts embeds the broad interface and overrides only the one
// method the decoration touches; unused methods would nil-panic, which is the
// point — the adapter must not call anything else here.
type stubRegisterAttempts struct {
	service.AuthAttemptService
	registered []string
}

func (s *stubRegisterAttempts) RegisterCreatedUser(_ context.Context, _, _, userID string) error {
	s.registered = append(s.registered, userID)
	return nil
}

type recordingEnsurer struct {
	calls []string
	err   error
}

func (r *recordingEnsurer) EnsurePersonalTeam(_ context.Context, _, userID string) error {
	r.calls = append(r.calls, userID)
	return r.err
}

func TestFlowAuthAttemptAdapter_RegisterCreatedUserRunsThePersonalTeamEnsure(t *testing.T) {
	attempts := &stubRegisterAttempts{}
	ens := &recordingEnsurer{}
	adapter := service.NewFlowAuthAttemptAdapter(attempts).WithPersonalTeamEnsurer(ens)

	require.NoError(t, adapter.RegisterCreatedUser(t.Context(), domain.FlowRegisterCreatedUserInput{
		ProjectID: ensureTestPlatform,
		AttemptID: "attempt_1",
		UserID:    "user_1",
	}))
	assert.Equal(t, []string{"user_1"}, attempts.registered)
	// Both the password path's on_success and the passkey path's
	// post-attestation registration land here — one decoration covers every
	// credential.
	assert.Equal(t, []string{"user_1"}, ens.calls)
}

func TestFlowAuthAttemptAdapter_EnsureFailureDoesNotFailRegistration(t *testing.T) {
	// The user and factor are committed when the side effect runs; the flow
	// step must not fail on it. The session-exchange self-heal covers a miss.
	attempts := &stubRegisterAttempts{}
	ens := &recordingEnsurer{err: errors.New("transient")}
	adapter := service.NewFlowAuthAttemptAdapter(attempts).WithPersonalTeamEnsurer(ens)

	require.NoError(t, adapter.RegisterCreatedUser(t.Context(), domain.FlowRegisterCreatedUserInput{
		ProjectID: ensureTestPlatform,
		AttemptID: "attempt_1",
		UserID:    "user_1",
	}))
	assert.Equal(t, []string{"user_1"}, attempts.registered)
}
