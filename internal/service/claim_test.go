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
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
				s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1"}, nil)
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
			name: "missing scope row counts as unclaimed",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, captured **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
				s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
				s.EXPECT().CreateChallenge(gomock.Any(), gomock.Any()).Return(nil)
			},
			check: func(t *testing.T, got *service.ClaimInitResult, _ *domain.ClaimChallenge) {
				assert.NotEmpty(t, got.ChallengeID)
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
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
				s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1", TeamID: &teamID}, nil)
			},
			wantErr: domain.ErrProjectAlreadyClaimed(),
		},
		{
			name: "insert failure propagates",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements, _ **domain.ClaimChallenge) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
				s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1"}, nil)
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

	completedGrantStmts := func(s *servicemocks.MockAllStatements, assignments []*domain.AuthzAssignment) {
		s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1", TeamID: &teamID}, nil)
		s.EXPECT().ListAuthzAssignments(gomock.Any(), "proj_1", domain.AuthzPrincipalTypeTeam, teamID, false).Return(assignments, nil)
	}
	claimGrant := &domain.AuthzAssignment{ObjectType: "project", Relation: "team", CreatedAt: claimedAt}
	decoyGrant := &domain.AuthzAssignment{ObjectType: "project", Relation: "viewer", CreatedAt: claimedAt.Add(-time.Hour)}

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
			},
			want: &service.ClaimStatusResult{Status: domain.ClaimChallengeStatusPending},
		},
		{
			name:       "pending expired",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(past), nil)
			},
			wantErr: domain.ErrProjectClaimExpired(),
		},
		{
			name:       "completed",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(future), nil)
				completedGrantStmts(s, []*domain.AuthzAssignment{decoyGrant, claimGrant})
			},
			want: &service.ClaimStatusResult{
				Status:       domain.ClaimChallengeStatusCompleted,
				TeamID:       teamID,
				ClaimedAt:    claimedAt,
				DashboardURL: claimConsoleBase + "/projects/proj_1",
			},
		},
		{
			name:       "completed stays completed past expiry",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(past), nil)
				completedGrantStmts(s, []*domain.AuthzAssignment{claimGrant})
			},
			want: &service.ClaimStatusResult{
				Status:       domain.ClaimChallengeStatusCompleted,
				TeamID:       teamID,
				ClaimedAt:    claimedAt,
				DashboardURL: claimConsoleBase + "/projects/proj_1",
			},
		},
		{
			name:       "completed but scope has no team",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(future), nil)
				s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1"}, nil)
			},
			wantErr: domain.ErrInternal(nil),
		},
		{
			name:       "completed but grant row missing",
			secretHash: "secret_hash_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(completedClaimChallenge(future), nil)
				completedGrantStmts(s, []*domain.AuthzAssignment{decoyGrant})
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
		s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
		s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1"}, nil)
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
				s.EXPECT().UpsertResourceScope(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, scope *domain.ResourceScope) error {
						assert.Equal(t, "proj_1", scope.ResourceID)
						assert.Equal(t, domain.ResourceKindProject, scope.ResourceKind)
						assert.Equal(t, "proj_1", scope.ProjectID)
						require.NotNil(t, scope.TeamID)
						assert.Equal(t, teamID, *scope.TeamID)
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
			},
			wantErr: domain.ErrProjectClaimExpired(),
		},
		{
			name: "project claimed via another challenge",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				otherTeam := "team_2"
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
				s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1", TeamID: &otherTeam}, nil)
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
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
				s.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{ResourceID: "proj_1", TeamID: &teamID}, nil)
			},
			wantErr:      domain.ErrProjectAlreadyClaimed(),
			wantConflict: "team_1",
		},
		{
			name: "no personal team",
			setupStmt: func(t *testing.T, s *servicemocks.MockAllStatements) {
				s.EXPECT().GetChallengeByID(gomock.Any(), "proj_1", claimTokenID).Return(pendingClaimChallenge(future), nil)
				unclaimedProjectStmts(s)
				s.EXPECT().GetPersonalTeamForUser(gomock.Any(), claimPlatformProjID, "usr_1").Return(nil, database.NewNoRowFoundError(nil))
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
