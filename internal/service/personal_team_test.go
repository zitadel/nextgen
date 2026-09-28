package service_test

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const ensureTestPlatform = "proj_platform"

type ensureFixture struct {
	ensurer service.PersonalTeamEnsurer
	v2Pool  *servicemocks.MockPool
	stmts   *servicemocks.MockAllStatements
}

func newEnsureFixture(t *testing.T) *ensureFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	v2Pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	v2Pool.EXPECT().Statements().Return(stmts).AnyTimes()

	return &ensureFixture{
		ensurer: service.NewPersonalTeamService(service.NewPool(v2Pool), ensureTestPlatform),
		v2Pool:  v2Pool,
		stmts:   stmts,
	}
}

func expectEnsureTx(f *ensureFixture) {
	f.v2Pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, v2TestTx{stmts: f.stmts})
		})
}

func membership(status domain.MembershipStatus) *domain.TeamMembership {
	return &domain.TeamMembership{
		ProjectID: ensureTestPlatform,
		TeamID:    "team_existing",
		UserID:    "user_1",
		Status:    status,
	}
}

func TestEnsurePersonalTeam_NoOpOutsidePlatformProject(t *testing.T) {
	// Every registration in every customer project passes through the same
	// funnel; none of those may mint teams — and none may even be read.
	f := newEnsureFixture(t)

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), "proj_customer", "user_1"))
}

func TestEnsurePersonalTeam_NoOpWhenUnconfigured(t *testing.T) {
	// An empty platform id — the wiring's value for every deployment that did
	// not opt in via platform.bootstrap_project — makes the ensure a universal
	// no-op, even for a project that happens to match "".
	ctrl := gomock.NewController(t)
	v2Pool := servicemocks.NewMockPool(ctrl)
	ensurer := service.NewPersonalTeamService(service.NewPool(v2Pool), "")

	require.NoError(t, ensurer.EnsurePersonalTeam(t.Context(), "proj_anything", "user_1"))
	require.NoError(t, ensurer.EnsurePersonalTeam(t.Context(), "", "user_1"))
}

func TestEnsurePersonalTeam_NoOpWhenMembershipExists(t *testing.T) {
	// Idempotency: any earliest active membership IS the personal team —
	// seeded, migrated, or a previous ensure. No transaction is opened.
	f := newEnsureFixture(t)
	f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, "user_1").
		Return(membership(domain.MembershipStatusActive), nil)

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1"))
}

func TestEnsurePersonalTeam_ReportsAnInactiveEarliestMembership(t *testing.T) {
	// An administrator took this user's team away, or their invitation is still
	// pending. Claim resolves the earliest membership and would keep seeing this
	// one, so minting a second team would not restore the claim and would leave
	// a stray team behind: the ensure must not provision. It reports the state
	// rather than succeeding silently, so a caller can say something more useful
	// than "you have no team". No transaction is opened.
	for _, status := range []domain.MembershipStatus{
		domain.MembershipStatusRemoved,
		domain.MembershipStatusInactive,
		domain.MembershipStatusPending,
	} {
		t.Run(string(status), func(t *testing.T) {
			f := newEnsureFixture(t)
			f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, "user_1").
				Return(membership(status), nil)

			err := f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1")
			require.ErrorIs(t, err, domain.ErrPersonalTeamNotActive(""),
				"must be distinguishable from having no team at all")
			// The status rides along so a UI can tell a removed team from a
			// pending invitation.
			var de domain.Error
			require.ErrorAs(t, err, &de)
			assert.Equal(t, domain.PersonalTeamNotActiveDetails{MembershipStatus: string(status)}, de.Details)
		})
	}
}

func TestEnsurePersonalTeam_ProvisionsTeamAndMembershipTogether(t *testing.T) {
	f := newEnsureFixture(t)
	f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, "user_1").
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
	// A pure function of the user id, and that is the one-team-per-user
	// constraint: it is what makes a second concurrent ensure collide on the
	// unique index instead of minting a second team. The id is hashed rather
	// than embedded, so a name can never carry it verbatim.
	assert.NotEmpty(t, team.Name)
	assert.NotContains(t, team.Name, "user_1", "the raw id must not reach the name")
	assert.Less(t, utf8.RuneCountInString(team.Name), domain.TeamNameMaxLength)
	require.NotNil(t, membership)
	assert.Equal(t, "team_minted", membership.TeamID, "membership must join the team minted in the same transaction")
	assert.Equal(t, "user_1", membership.UserID)
	assert.Equal(t, domain.MembershipStatusActive, membership.Status)
}

func TestEnsurePersonalTeam_TheNameIsAPureFunctionOfTheUserID(t *testing.T) {
	// The property the one-team-per-user guarantee rests on: same user, same
	// name, every time — so the unique index can reject the second insert.
	// Different users never collide with each other.
	// The ids cover what a caller-supplied id can look like: user ids carry no
	// length limit and a case-sensitive collation, so a very long one and a
	// pair differing only in case are both legal and both used to break this.
	// The long id would have produced a name over TeamNameMaxLength, and the
	// case pair would have collided in the case-insensitive name index,
	// permanently blocking whichever user arrived second.
	longID := "user_" + strings.Repeat("x", 300)
	names := map[string]string{}
	for _, userID := range []string{"user_1", "user_1", "user_2", "USER_2", longID} {
		f := newEnsureFixture(t)
		f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, userID).
			Return(nil, database.NewNoRowFoundError(nil))
		f.stmts.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, tm *domain.Team) error {
				if prev, seen := names[userID]; seen {
					assert.Equal(t, prev, tm.Name, "same user must always yield the same name")
				}
				names[userID] = tm.Name
				return nil
			})
		f.stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
		f.stmts.EXPECT().CreateTeamMembership(gomock.Any(), gomock.Any()).Return(nil)
		expectEnsureTx(f)

		require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, userID))
	}
	assert.NotEqual(t, names["user_1"], names["user_2"], "different users must not collide")
	assert.NotEqual(t, strings.ToLower(names["user_2"]), strings.ToLower(names["USER_2"]),
		"ids differing only in case must not collide in the case-insensitive name index")
	for id, name := range names {
		assert.Less(t, utf8.RuneCountInString(name), domain.TeamNameMaxLength,
			"the name for %q must stay under the team-name cap", id[:min(len(id), 20)])
	}
}

func TestEnsurePersonalTeam_LostRaceConvergesOnTheWinner(t *testing.T) {
	// Registration racing the first sign-in for the SAME user: both compute the
	// same name, so the loser's CreateTeam hits the unique index. The winner
	// committed team AND membership together, so the re-check confirms
	// convergence — one team, not two.
	f := newEnsureFixture(t)
	gomock.InOrder(
		f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, "user_1").
			Return(nil, database.NewNoRowFoundError(nil)),
		f.stmts.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("teams", "uq_teams_project_name", nil)),
		f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, "user_1").
			Return(membership(domain.MembershipStatusActive), nil),
	)
	expectEnsureTx(f)

	require.NoError(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1"))
}

func TestEnsurePersonalTeam_LostRaceBeforeTheWinnerCommitsReportsRatherThanRetrying(t *testing.T) {
	// Same collision, but the winner has not committed yet, so the re-check
	// still finds no membership. The ensure must report and let the next
	// sign-in heal: retrying under a different name here is exactly what would
	// produce a second team. This is also the shape of an unrelated team
	// holding the name.
	f := newEnsureFixture(t)
	gomock.InOrder(
		f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, "user_1").
			Return(nil, database.NewNoRowFoundError(nil)),
		f.stmts.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("teams", "uq_teams_project_name", nil)),
		f.stmts.EXPECT().GetEarliestTeamMembership(gomock.Any(), ensureTestPlatform, "user_1").
			Return(nil, database.NewNoRowFoundError(nil)),
	)
	expectEnsureTx(f)

	// No second CreateTeam is expected: gomock fails the test if one happens.
	require.Error(t, f.ensurer.EnsurePersonalTeam(t.Context(), ensureTestPlatform, "user_1"))
}
