package service_test

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	claimConsoleBase    = "https://console.invalid/ui/console"
	claimPlatformProjID = "proj_platform"
)

// claimToken is a fixed plaintext challenge token; claimTokenID is what the
// service must derive from it before touching storage.
var (
	claimToken   = domain.PrefixClaimChallenge.IDPrefix("dGVzdC10b2tlbg")
	claimTokenID = domain.HashClaimChallengeToken(claimToken)
	future       = time.Now().Add(5 * time.Minute)
	past         = time.Now().Add(-time.Minute)
)

func pendingClaimChallenge(expiresAt time.Time) *domain.ClaimChallenge {
	return &domain.ClaimChallenge{
		ID:                   claimTokenID,
		ProjectID:            "proj_1",
		InitiatingSecretHash: "secret_hash_1",
		Status:               domain.ClaimChallengeStatusPending,
		ExpiresAt:            expiresAt,
	}
}

func completedClaimChallenge(expiresAt time.Time) *domain.ClaimChallenge {
	c := pendingClaimChallenge(expiresAt)
	c.Status = domain.ClaimChallengeStatusCompleted
	return c
}

// claimableProject is a fresh unclaimed project row: created now, well inside
// domain.ClaimWindow. The window tests override CreatedAt.
func claimableProject() *domain.Project {
	return &domain.Project{ID: "proj_1", CreatedAt: time.Now()}
}

func expiredWindowProject() *domain.Project {
	p := claimableProject()
	p.CreatedAt = time.Now().Add(-domain.ClaimWindow - time.Hour)
	return p
}

func requireClaimConflictDetails(t *testing.T, err error, teamID string) {
	t.Helper()
	var de domain.Error
	require.ErrorAs(t, err, &de)
	assert.Equal(t, domain.ClaimConflictDetails{
		TeamID:       teamID,
		DashboardURL: claimConsoleBase + "/projects/proj_1",
	}, de.Details)
}

func TestClaimService_Init(t *testing.T) {
	t.Parallel()

	teamID := "team_1"
	tests := []struct {
		name      string
		setupStmt func(t *testing.T, s *servicemocks.MockAllStatements, captured **domain.ClaimChallenge)
		wantErr   error
		check     func(t *testing.T, got *service.ClaimInitResult, captured *domain.ClaimChallenge)
	}{
		{
			name: "ok",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, captured **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
				s.EXPECT().CreateChallenge(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, entity *domain.ClaimChallenge) error {
						*captured = entity
						return nil
					})
			},
			check: func(t *testing.T, got *service.ClaimInitResult, captured *domain.ClaimChallenge) {
				assert.True(t, strings.HasPrefix(got.ChallengeID, "ch_"))
				assert.Equal(t, domain.HashClaimChallengeToken(got.ChallengeID), captured.ID)
				assert.Equal(t, "proj_1", captured.ProjectID)
				assert.Equal(t, "secret_hash_1", captured.InitiatingSecretHash)
				assert.Equal(t, domain.ClaimChallengeStatusPending, captured.Status)
				assert.WithinDuration(t, time.Now().Add(domain.ClaimChallengeTTL), captured.ExpiresAt, 2*time.Second)
				assert.Equal(t, captured.ExpiresAt, got.ExpiresAt)
				wantQuery := url.Values{"challenge_id": {got.ChallengeID}, "project_id": {"proj_1"}}.Encode()
				assert.Equal(t, claimConsoleBase+"/claim?"+wantQuery, got.ClaimURL)
			},
		},
		{
			name: "project not found",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, _ **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectNotFound(),
		},
		{
			name: "already claimed",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, _ **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: teamID}, nil)
			},
			wantErr: domain.ErrProjectAlreadyClaimed(),
		},
		{
			name: "claim window closed",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, _ **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimWindowExpired(),
		},
		{
			// Ordering: a claimed project answers 409 even once its window is
			// past, so the conflict details keep naming the owning team.
			name: "already claimed wins over closed window",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, _ **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: teamID}, nil)
			},
			wantErr: domain.ErrProjectAlreadyClaimed(),
		},
		{
			name: "insert failure propagates",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, _ **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
				s.EXPECT().CreateChallenge(gomock.Any(), gomock.Any()).Return(errors.New("boom"))
			},
			wantErr: domain.ErrInternal(nil),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var captured *domain.ClaimChallenge
			svc := newMockedClaimService(t, func(s *servicemocks.MockAllStatements) {
				tc.setupStmt(t, s, &captured)
			})

			got, err := svc.Init(t.Context(), "proj_1", "secret_hash_1")
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				if errors.Is(tc.wantErr, domain.ErrProjectAlreadyClaimed()) {
					requireClaimConflictDetails(t, err, teamID)
				}
				return
			}
			require.NoError(t, err)
			tc.check(t, got, captured)
		})
	}
}

func TestClaimService_Status(t *testing.T) {
	t.Parallel()

	teamID := "team_1"
	claimedAt := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)

	claimGrant := &domain.AuthzAssignment{
		ObjectType: "project", Relation: "team",
		PrincipalType: domain.AuthzPrincipalTypeTeam, PrincipalID: teamID,
		CreatedAt: claimedAt,
	}

	tests := []struct {
		name       string
		secretHash string
		setupStmt  func(s *servicemocks.MockAllStatements)
		wantErr    error
		want       *service.ClaimStatusResult
	}{
		{
			name:       "challenge not found",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrClaimChallengeNotFound(),
		},
		{
			name:       "secret mismatch",
			secretHash: "someone_elses_hash",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
			},
			wantErr: domain.ErrProjectPermissionDenied(),
		},
		{
			name:       "secret mismatch wins over expiry",
			secretHash: "someone_elses_hash",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(past), nil)
			},
			wantErr: domain.ErrProjectPermissionDenied(),
		},
		{
			name:       "pending",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			want: &service.ClaimStatusResult{Status: domain.ClaimChallengeStatusPending},
		},
		{
			name:       "pending expired",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(past), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimExpired(),
		},
		{
			// Reachable when the window closes between init and poll: Init
			// refuses to mint once it is already closed.
			name:       "claim window closed",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimWindowExpired(),
		},
		{
			// Both are 410, but only challenge expiry recovers with a fresh
			// init, so the final refusal must win.
			name:       "claim window closed wins over challenge expiry",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(past), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimWindowExpired(),
		},
		{
			name:       "completed",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(future), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(claimGrant, nil)
			},
			want: &service.ClaimStatusResult{
				Status:       domain.ClaimChallengeStatusCompleted,
				TeamID:       teamID,
				ClaimedAt:    claimedAt,
				DashboardURL: claimConsoleBase + "/projects/proj_1",
			},
		},
		{
			// Grant-first also means completed survives a closed window: the
			// claim landed in time, and the verdict must not flip afterwards.
			name:       "completed stays completed past expiry and closed window",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(past), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(claimGrant, nil)
			},
			want: &service.ClaimStatusResult{
				Status:       domain.ClaimChallengeStatusCompleted,
				TeamID:       teamID,
				ClaimedAt:    claimedAt,
				DashboardURL: claimConsoleBase + "/projects/proj_1",
			},
		},
		{
			// The grant, not the polled challenge, is the claim source of
			// truth: a project claimed through ANOTHER challenge reports
			// completed with its owning team, never a false closed-window
			// verdict, even once day 14 has passed mid-poll.
			name:       "claimed through another challenge reports completed past the window",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(past), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(claimGrant, nil)
			},
			want: &service.ClaimStatusResult{
				Status:       domain.ClaimChallengeStatusCompleted,
				TeamID:       teamID,
				ClaimedAt:    claimedAt,
				DashboardURL: claimConsoleBase + "/projects/proj_1",
			},
		},
		{
			name:       "completed but grant row missing",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(future), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInternal(nil),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedClaimService(t, tc.setupStmt)

			got, err := svc.Status(t.Context(), "proj_1", claimToken, tc.secretHash)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestClaimService_Complete(t *testing.T) {
	t.Parallel()

	teamID := "team_1"
	claimedAt := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)

	unclaimedProjectStmts := func(s *servicemocks.MockAllStatements) {
		s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
		s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
	}

	tests := []struct {
		name         string
		setupStmt    func(t *testing.T, s *servicemocks.MockAllStatements)
		wantErr      error
		wantConflict string // team id expected in 409 details
		want         *service.ClaimCompleteResult
	}{
		{
			name: "ok",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(&domain.Team{ID: teamID}, nil)
				s.EXPECT().MarkChallengeCompleted(gomock.Any(), "proj_1", claimTokenID).Return(nil)
				s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, a *domain.AuthzAssignment) error {
						assert.Equal(t, "proj_1", a.ProjectID)
						assert.Equal(t, domain.SystemCatalogID, a.CatalogID)
						assert.Equal(t, domain.AuthzPrincipalTypeTeam, a.PrincipalType)
						assert.Equal(t, teamID, a.PrincipalID)
						assert.Equal(t, "project", a.ObjectType)
						assert.Equal(t, "team", a.Relation)
						assert.Equal(t, domain.AuthzScopeKindProject, a.ScopeKind)
						a.ID = "asgn_1"
						a.CreatedAt = claimedAt
						return nil
					})
			},
			want: &service.ClaimCompleteResult{ProjectID: "proj_1", TeamID: teamID, ClaimedAt: claimedAt},
		},
		{
			name: "challenge not found",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrClaimChallengeNotFound(),
		},
		{
			name: "challenge expired",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(past), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimExpired(),
		},
		{
			// Both expired: the final refusal must win, matching Status —
			// a fresh claim init recovers only from an expired challenge.
			name: "claim window closed wins over challenge expiry",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(past), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimWindowExpired(),
		},
		{
			name: "claim window closed",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(expiredWindowProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimWindowExpired(),
		},
		{
			name: "project claimed via another challenge",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_2"}, nil)
			},
			wantErr:      domain.ErrProjectAlreadyClaimed(),
			wantConflict: "team_2",
		},
		{
			// A completed challenge implies the grant exists, so a re-spend
			// reports 409 already claimed (not 410) even once the challenge
			// window has passed. Deliberate deviation from the ticket text,
			// matching the OpenAPI contract and the api-mock.
			name: "re-spent completed challenge reports already claimed",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(past), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: teamID}, nil)
			},
			wantErr:      domain.ErrProjectAlreadyClaimed(),
			wantConflict: "team_1",
		},
		{
			// No membership at all: the user is provisioned a team on the next
			// sign-in (#527), so the refusal clears itself.
			name: "no personal team",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(nil, database.NewNoRowFoundError(nil))
				s.EXPECT().GetEarliestTeamMembership(gomock.Any(), claimPlatformProjID, "usr_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrClaimNoPersonalTeam(),
		},
		{
			// Same not-found from the resolver, different cause: the team is
			// there but deactivated, so no sign-in will fix it and the client
			// must be told something else.
			name: "personal team exists but is not active",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(nil, database.NewNoRowFoundError(nil))
				s.EXPECT().GetEarliestTeamMembership(gomock.Any(), claimPlatformProjID, "usr_1").
					Return(&domain.TeamMembership{
						ProjectID: claimPlatformProjID,
						TeamID:    "team_gone",
						UserID:    "usr_1",
						Status:    domain.MembershipStatusRemoved,
					}, nil)
			},
			wantErr: domain.ErrPersonalTeamNotActive(string(domain.MembershipStatusRemoved)),
		},
		{
			// The two reads take separate snapshots under read-committed, so a
			// provisioning commit in between can show an active membership after
			// the resolver has already refused. Reporting "not active: active"
			// would be self-contradictory; the original verdict is the honest
			// one and the next attempt succeeds.
			name: "membership turned active between the two reads",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(nil, database.NewNoRowFoundError(nil))
				s.EXPECT().GetEarliestTeamMembership(gomock.Any(), claimPlatformProjID, "usr_1").
					Return(&domain.TeamMembership{
						ProjectID: claimPlatformProjID,
						TeamID:    "team_fresh",
						UserID:    "usr_1",
						Status:    domain.MembershipStatusActive,
					}, nil)
			},
			wantErr: domain.ErrClaimNoPersonalTeam(),
		},
		{
			name: "lost the same-challenge race",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(&domain.Team{ID: teamID}, nil)
				s.EXPECT().MarkChallengeCompleted(gomock.Any(), "proj_1", claimTokenID).Return(database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectClaimExpired(),
		},
		{
			// Two different pending challenges racing on one project: the loser's
			// grant insert conflicts on authz_assignments_one_owning_team
			// (ADR 054 §2) and Complete re-reads the winner for the 409 details.
			name: "lost the cross-challenge race maps the unique violation to 409",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(&domain.Team{ID: teamID}, nil)
				s.EXPECT().MarkChallengeCompleted(gomock.Any(), "proj_1", claimTokenID).Return(nil)
				s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).
					Return(database.NewUniqueError("authz_assignments", "authz_assignments_one_owning_team", nil))
				// The post-transaction re-read sees the winner's grant.
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(claimableProject(), nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_2"}, nil)
			},
			wantErr:      domain.ErrProjectAlreadyClaimed(),
			wantConflict: "team_2",
		},
		{
			name: "grant write failure propagates",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(&domain.Team{ID: teamID}, nil)
				s.EXPECT().MarkChallengeCompleted(gomock.Any(), "proj_1", claimTokenID).Return(nil)
				s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).Return(errors.New("boom"))
			},
			wantErr: domain.ErrInternal(nil),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedClaimService(t, func(s *servicemocks.MockAllStatements) {
				tc.setupStmt(t, s)
			})

			got, err := svc.Complete(t.Context(), "proj_1", claimToken, "usr_1")
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				if tc.wantConflict != "" {
					requireClaimConflictDetails(t, err, tc.wantConflict)
				}
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func newMockedClaimService(t *testing.T, setupStmt func(*servicemocks.MockAllStatements)) service.ClaimService {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	setupStmt(statements)

	return service.NewClaimService(service.NewPool(pool), claimConsoleBase, claimPlatformProjID)
}
