//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestUserStatements_DeleteCascadesSessionAndToken(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		user := newTestUser(t, projectID, schemaURL, "user-cascade-"+uniqueSuffix(t), "cascade@example.com", "Cascade User")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		plain, _ := handoffCompletedAttemptWithUser(t, d.stmts, projectID, user.ID)
		exchanged, err := d.stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
		require.NoError(t, err)
		require.NotEmpty(t, exchanged.ID)
		require.NotEmpty(t, exchanged.TokenID)
		require.NotNil(t, exchanged.UserID)
		assert.Equal(t, user.ID, *exchanged.UserID)
		t.Cleanup(func() {
			_ = d.stmts.DeleteSessionByID(context.Background(), projectID, exchanged.ID)
		})

		tokenID := exchanged.TokenID
		sessionID := exchanged.ID

		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), projectID, user.ID))

		_, err = d.stmts.GetSessionByID(t.Context(), projectID, sessionID)
		assert.True(t, errors.Is(err, domain.ErrSessionNotFound()), "session should cascade with user: %v", err)

		_, err = d.stmts.GetTokenByID(t.Context(), projectID, tokenID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "session token should cascade with user")
	})
}

// TestSessionStatements_ExchangeUpgradesSessionInPlace covers the #755 lifecycle:
// a flow persists an anonymous building session, its auth-attempt links to that
// session, and exchange upgrades the same row (building -> active) instead of
// creating a second session.
func TestSessionStatements_ExchangeUpgradesSessionInPlace(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		user := newTestUser(t, projectID, schemaURL, "user-upgrade-"+uniqueSuffix(t), "upgrade@example.com", "Upgrade User")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		// The anonymous building session persisted when the flow started, with the
		// request's device context recorded on it.
		session, err := domain.NewSession(projectID, &domain.UserAgent{
			IP:   "203.0.113.9",
			Info: map[string]any{"user_agent": "agent/1"},
		})
		require.NoError(t, err)
		require.NoError(t, d.stmts.CreateSession(t.Context(), session))
		require.NotEmpty(t, session.ID)
		require.Equal(t, domain.SessionStateBuilding, session.State())
		sessionID := session.ID
		t.Cleanup(func() {
			_ = d.stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
		})

		// The flow's auth-attempt links to that session.
		plain, _ := handoffCompletedAttempt(t, d.stmts, projectID, func(a *domain.AuthAttempt) {
			a.SessionID = &sessionID
			a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}
			a.Checks = []domain.AuthCheck{
				&domain.AuthFactorUser{UserID: user.ID},
				&domain.AuthFactorPassword{},
			}
		})

		exchanged, err := d.stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
		require.NoError(t, err)
		// Same session, upgraded in place: no duplicate id.
		require.Equal(t, sessionID, exchanged.ID, "exchange must upgrade the existing session, not mint a new one")
		require.NotNil(t, exchanged.UserID)
		assert.Equal(t, user.ID, *exchanged.UserID)
		assert.Equal(t, domain.SessionStateActive, exchanged.State())
		// The user agent recorded at creation survives the in-place upgrade.
		require.NotNil(t, exchanged.UserAgent, "user agent must survive exchange")
		assert.Equal(t, "203.0.113.9", exchanged.UserAgent.IP)

		got, err := d.stmts.GetSessionByID(t.Context(), projectID, sessionID)
		require.NoError(t, err)
		assert.Equal(t, domain.SessionStateActive, got.State())
		assert.NotEmpty(t, got.Factors, "verified factors promoted onto the upgraded session")
		require.NotNil(t, got.UserAgent, "user agent persisted through exchange")
		assert.Equal(t, "203.0.113.9", got.UserAgent.IP)
	})
}

func createAnonymousSession(t *testing.T, stmts service.AllStatements, projectID string) *domain.Session {
	t.Helper()
	session, err := domain.NewSession(projectID, nil)
	require.NoError(t, err)
	require.NoError(t, stmts.CreateSession(t.Context(), session))
	sessionID := session.ID
	t.Cleanup(func() {
		_ = stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
	})
	return session
}

func createUserBoundSession(t *testing.T, stmts service.AllStatements, projectID, userID string) *domain.Session {
	t.Helper()
	plain, _ := handoffCompletedAttempt(t, stmts, projectID, func(a *domain.AuthAttempt) {
		a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser}
		a.Checks = []domain.AuthCheck{&domain.AuthFactorUser{UserID: userID}}
	})
	session, err := stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
	require.NoError(t, err)
	require.NotNil(t, session.UserID)
	sessionID := session.ID
	t.Cleanup(func() {
		_ = stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
	})
	return session
}

// createTwoCheckSession exchanges an attempt with verified user and password
// factors, so the session carries two check rows.
func createTwoCheckSession(t *testing.T, stmts service.AllStatements, projectID, userID string) *domain.Session {
	t.Helper()
	plain, _ := handoffCompletedAttemptWithUser(t, stmts, projectID, userID)
	session, err := stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
	require.NoError(t, err)
	sessionID := session.ID
	t.Cleanup(func() {
		_ = stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
	})
	return session
}

// pageAllSessionIDs pages the project's sessions ordered by (user_id, id) with
// the given limit until the cursor runs dry, guarding against a paging loop
// that never terminates.
func pageAllSessionIDs(t *testing.T, stmts service.AllStatements, projectID string, direction database.OrderDirection, limit uint32, wantLen int) []string {
	t.Helper()

	page := database.Page[domain.SessionField]{
		Limit: limit,
		OrderBy: database.OrderBy[domain.SessionField]{
			Columns: []database.Column[domain.SessionField]{
				database.Col(domain.SessionFieldUserID),
				database.Col(domain.SessionFieldID),
			},
			Direction: direction,
		},
	}
	filter := database.Equal(database.Col(domain.SessionFieldProjectID), projectID)

	var got []string
	for pages := 0; ; pages++ {
		require.LessOrEqual(t, pages, wantLen, "paging did not terminate")
		result, err := stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
			Filter:     filter,
			Pagination: page,
		})
		require.NoError(t, err)
		for _, session := range result.Items {
			got = append(got, session.ID)
		}
		if len(result.NextCursor) == 0 {
			return got
		}
		page.Cursor = result.NextCursor
	}
}

// TestSessionStatements_List_PagesNullUserID pages a mix of anonymous and
// user-bound sessions sorted by the nullable user_id. Ascending is the
// original Postgres repro (NULLs ordered last lost the anonymous sessions);
// descending ends page one on a non-nil cursor, so the NULL block beyond it
// must still be reachable.
func TestSessionStatements_List_PagesNullUserID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		want := make([]string, 0, 4)
		for range 2 {
			want = append(want, createAnonymousSession(t, d.stmts, projectID).ID)
		}
		for _, prefix := range []string{"usr-a-", "usr-b-"} {
			userID := prefix + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Paging User")))
			t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
			want = append(want, createUserBoundSession(t, d.stmts, projectID, userID).ID)
		}

		for name, direction := range map[string]database.OrderDirection{
			"asc":  database.OrderAsc,
			"desc": database.OrderDesc,
		} {
			t.Run(name, func(t *testing.T) {
				got := pageAllSessionIDs(t, d.stmts, projectID, direction, 2, len(want))
				assert.ElementsMatch(t, want, got, "every session must appear exactly once across all pages")
			})
		}
	})
}

// TestSessionStatements_List_NullBlockSpansPages forces the cursor to carry a
// NULL: three anonymous sessions with a page size of two put a page boundary
// inside the NULL block in both directions.
func TestSessionStatements_List_NullBlockSpansPages(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		want := make([]string, 0, 4)
		for range 3 {
			want = append(want, createAnonymousSession(t, d.stmts, projectID).ID)
		}
		userID := "usr-null-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Null Block User")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		want = append(want, createUserBoundSession(t, d.stmts, projectID, userID).ID)

		for name, direction := range map[string]database.OrderDirection{
			"asc":  database.OrderAsc,
			"desc": database.OrderDesc,
		} {
			t.Run(name, func(t *testing.T) {
				got := pageAllSessionIDs(t, d.stmts, projectID, direction, 2, len(want))
				assert.ElementsMatch(t, want, got, "every session must appear exactly once across all pages")
			})
		}
	})
}

// TestSessionStatements_List_LimitBoundsSessions pages three sessions that
// carry two check rows each. The limit must bound sessions, not joined rows:
// a limit on joined rows shrinks the page and withholds the cursor, making
// the remaining sessions unreachable.
func TestSessionStatements_List_LimitBoundsSessions(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		userID := "usr-2fa-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Two Check User")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		want := make([]string, 0, 3)
		for range 3 {
			want = append(want, createTwoCheckSession(t, d.stmts, projectID, userID).ID)
		}
		slices.Sort(want)

		list := func(cursor []byte) *database.ListResult[*domain.Session] {
			result, err := d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
				Filter: database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
				Pagination: database.Page[domain.SessionField]{
					Limit:  2,
					Cursor: cursor,
					OrderBy: database.OrderBy[domain.SessionField]{
						Columns: []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
					},
				},
			})
			require.NoError(t, err)
			return result
		}

		page1 := list(nil)
		require.Len(t, page1.Items, 2, "a full page must hold as many sessions as the limit")
		require.NotEmpty(t, page1.NextCursor, "a full page must issue a next cursor")

		page2 := list(page1.NextCursor)
		require.Len(t, page2.Items, 1)
		assert.Empty(t, page2.NextCursor)

		got := make([]string, 0, 3)
		for _, session := range append(page1.Items, page2.Items...) {
			assert.Len(t, session.Factors, 2, "session %s must keep its complete factor list", session.ID)
			got = append(got, session.ID)
		}
		// Exact order, not ElementsMatch: the ORDER BY after the joins is
		// otherwise unfenced.
		assert.Equal(t, want, got, "pages must return every session exactly once, in ID order")
	})
}

// TestSessionStatements_List_LimitKeepsFactorsComplete lists a two-check
// session with limit 1. A limit on joined rows would cut inside the session's
// check rows and truncate its factor list.
func TestSessionStatements_List_LimitKeepsFactorsComplete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		userID := "usr-2fa-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Two Check User")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		created := createTwoCheckSession(t, d.stmts, projectID, userID)

		result, err := d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
			Filter:     database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
			Pagination: database.Page[domain.SessionField]{Limit: 1},
		})
		require.NoError(t, err)
		require.Len(t, result.Items, 1)
		require.Equal(t, created.ID, result.Items[0].ID)

		gotTypes := make([]domain.AuthCheckType, 0, len(result.Items[0].Factors))
		for _, factor := range result.Items[0].Factors {
			gotTypes = append(gotTypes, factor.Type())
		}
		assert.ElementsMatch(t, []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}, gotTypes,
			"the paged session must carry its complete factor list")
	})
}

// TestSessionStatements_List_StateColumnFilters exercises the filter shapes
// sessionService.List builds for the state filter.
func TestSessionStatements_List_StateColumnFilters(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		newAnonymousSession := func(ttl time.Duration) string {
			session, err := domain.NewSession(projectID, nil)
			require.NoError(t, err)
			session.TimeToLive = ttl
			require.NoError(t, d.stmts.CreateSession(t.Context(), session))
			sessionID := session.ID
			t.Cleanup(func() {
				_ = d.stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
			})
			return sessionID
		}

		buildingID := newAnonymousSession(time.Hour)
		expiredID := newAnonymousSession(time.Millisecond)

		userID := "usr-state-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "State User")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		activeID := createTwoCheckSession(t, d.stmts, projectID, userID).ID

		// A password-only exchange promotes a verified factor but binds no
		// user: the case the user_id proxy misclassified as building.
		plainPw, _ := handoffCompletedAttempt(t, d.stmts, projectID, nil)
		pwOnly, err := d.stmts.ExchangeSession(t.Context(), projectID, plainPw, nil, time.Hour)
		require.NoError(t, err)
		require.Nil(t, pwOnly.UserID)
		require.NotEmpty(t, pwOnly.Factors)
		pwOnlyID := pwOnly.ID
		t.Cleanup(func() { _ = d.stmts.DeleteSessionByID(context.Background(), projectID, pwOnlyID) })

		scope := database.Equal(database.Col(domain.SessionFieldProjectID), projectID)
		expiresAt := database.Col(domain.SessionFieldExpiresAt)
		hasFactors := database.Col(domain.SessionFieldHasVerifiedFactors)
		sessUserID := database.Col(domain.SessionFieldUserID)

		ctx := t.Context()
		// list takes require.TestingT so the EventuallyWithT poll can pass its
		// *assert.CollectT: require on the outer t would FailNow off the test
		// goroutine and kill the retry loop instead of retrying.
		list := func(t require.TestingT, filter database.Filter[domain.SessionField]) []*domain.Session {
			result, err := d.stmts.ListSessions(ctx, &database.ListOptions[domain.SessionField]{
				Filter: database.And(scope, filter),
				Pagination: database.Page[domain.SessionField]{
					OrderBy: database.OrderBy[domain.SessionField]{
						Columns: []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
					},
				},
			})
			require.NoError(t, err)
			return result.Items
		}
		ids := func(sessions []*domain.Session) []string {
			out := make([]string, 0, len(sessions))
			for _, session := range sessions {
				out = append(out, session.ID)
			}
			return out
		}
		// The column predicates are a proxy; domain.Session.State() is the
		// authority they must agree with.
		assertStates := func(t *testing.T, sessions []*domain.Session, want domain.SessionState) {
			for _, session := range sessions {
				assert.Equal(t, want, session.State(), "session %s: filter disagrees with State()", session.ID)
			}
		}

		// The 1ms TTL session expires relative to the database clock; poll
		// until the expired predicate sees it rather than trusting clock skew.
		require.EventuallyWithT(t, func(c *assert.CollectT) {
			assert.Contains(c, ids(list(c, database.LessThan(expiresAt, time.Now().UTC()))), expiredID)
		}, 5*time.Second, 50*time.Millisecond, "session with 1ms TTL must show up as expired")

		now := time.Now().UTC()
		live := database.Or(database.GreaterThan(expiresAt, now), database.Equal(expiresAt, now))

		expired := list(t, database.LessThan(expiresAt, now))
		// The has-verified-factors EXISTS must compile inside plain equality filters on every dialect.
		building := list(t, database.And(live, database.Equal(hasFactors, false)))
		active := list(t, database.And(live, database.Equal(hasFactors, true)))

		assert.ElementsMatch(t, []string{expiredID}, ids(expired), "expired: expires_at before now")
		assert.ElementsMatch(t, []string{buildingID}, ids(building), "building: live without verified factors")
		assert.ElementsMatch(t, []string{activeID, pwOnlyID}, ids(active), "active: live with verified factors, user bound or not")

		assertStates(t, expired, domain.SessionStateExpired)
		assertStates(t, building, domain.SessionStateBuilding)
		assertStates(t, active, domain.SessionStateActive)

		// check that plain (non-keyset) nil values compile to
		// IS NULL / IS NOT NULL on every dialect.
		userless := list(t, database.And(live, database.Equal(sessUserID, nil)))
		userBound := list(t, database.And(live, database.GreaterThan(sessUserID, nil)))
		assert.ElementsMatch(t, []string{buildingID, pwOnlyID}, ids(userless), "live and user_id IS NULL")
		assert.ElementsMatch(t, []string{activeID}, ids(userBound), "live and user_id IS NOT NULL")
	})
}

// TestSessionStatements_List_TeamFilter exercises the team filter, which is
// not a column: a session joins a team through its bound user's roster
// membership (ADR 056). One session matches every team its user is on, a
// session with no user matches none, and a removed membership stops matching.
func TestSessionStatements_List_TeamFilter(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		newTeam := func(label string) string {
			teamID := "team-" + label + "-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
			return teamID
		}
		newUser := func(label string) string {
			userID := "usr-" + label + "-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(),
				newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Team Filter "+label)))
			t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
			return userID
		}
		join := func(teamID, userID string, status domain.MembershipStatus) {
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamID, UserID: userID, Status: status,
			}))
		}

		teamA, teamB, teamC := newTeam("a"), newTeam("b"), newTeam("c")

		// One user on two teams, to prove a single project-scoped session
		// surfaces under every team its user belongs to.
		multiUser := newUser("multi")
		join(teamA, multiUser, domain.MembershipStatusActive)
		join(teamB, multiUser, domain.MembershipStatusPending)
		multiSessionID := createTwoCheckSession(t, d.stmts, projectID, multiUser).ID

		soloUser := newUser("solo")
		join(teamC, soloUser, domain.MembershipStatusActive)
		soloSessionID := createTwoCheckSession(t, d.stmts, projectID, soloUser).ID

		// An anonymous session has no user, so it can reach no membership row.
		anonymous, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, d.stmts.CreateSession(t.Context(), anonymous))
		t.Cleanup(func() { _ = d.stmts.DeleteSessionByID(context.Background(), projectID, anonymous.ID) })

		ctx := t.Context()
		listTeam := func(t *testing.T, teamID string) []string {
			t.Helper()
			result, err := d.stmts.ListSessions(ctx, &database.ListOptions[domain.SessionField]{
				Filter: database.And(
					database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
					database.CorrelatedEqual(database.Col(domain.SessionFieldTeamID), teamID),
				),
				Pagination: database.Page[domain.SessionField]{
					OrderBy: database.OrderBy[domain.SessionField]{
						Columns: []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
					},
				},
			})
			require.NoError(t, err)
			out := make([]string, 0, len(result.Items))
			for _, session := range result.Items {
				out = append(out, session.ID)
			}
			return out
		}

		assert.Equal(t, []string{multiSessionID}, listTeam(t, teamA), "active membership matches")
		assert.Equal(t, []string{multiSessionID}, listTeam(t, teamB), "the same session also surfaces under the user's other team, on a pending membership")
		assert.Equal(t, []string{soloSessionID}, listTeam(t, teamC), "a team only sees its own members' sessions")
		assert.Empty(t, listTeam(t, "team-does-not-exist"), "an unknown team matches nothing")

		for _, teamID := range []string{teamA, teamB, teamC} {
			assert.NotContains(t, listTeam(t, teamID), anonymous.ID, "a session with no user belongs to no team")
		}

		// inactive stays on the roster: a suspended member's live session must
		// remain visible to the team.
		require.NoError(t, d.stmts.UpdateTeamMembershipStatus(ctx, projectID, teamA, multiUser, domain.MembershipStatusInactive))
		assert.Equal(t, []string{multiSessionID}, listTeam(t, teamA), "inactive membership still matches")

		// removed is history, not roster.
		require.NoError(t, d.stmts.UpdateTeamMembershipStatus(ctx, projectID, teamA, multiUser, domain.MembershipStatusRemoved))
		assert.Empty(t, listTeam(t, teamA), "a removed membership stops matching")
		assert.Equal(t, []string{multiSessionID}, listTeam(t, teamB), "removal from one team leaves the others untouched")
	})
}
