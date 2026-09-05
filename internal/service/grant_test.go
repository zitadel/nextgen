package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const grantPlatformProjID = "proj_platform"

func TestGrantService_Create(t *testing.T) {
	t.Parallel()

	future := time.Now().Add(time.Hour)
	userID := "user_grant01"
	teamID := "team_grant01"

	tests := []struct {
		name      string
		input     service.CreateGrantInput
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.AuthzAssignment)
	}{
		{
			name: "ok user grant",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				Relation:      "viewer",
			},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				expectActiveUserPrincipal(s, userID)
				s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, a *domain.AuthzAssignment) error {
						a.ID = "asgn_test01"
						a.CreatedAt = time.Now()
						a.UpdatedAt = a.CreatedAt
						return nil
					})
				s.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil)
			},
			check: func(t *testing.T, got *domain.AuthzAssignment) {
				assert.Equal(t, "asgn_test01", got.ID)
				assert.Equal(t, "proj_customer", got.ProjectID)
				assert.Equal(t, domain.AuthzPrincipalTypeUser, got.PrincipalType)
				assert.Equal(t, userID, got.PrincipalID)
				assert.Equal(t, "project", got.ObjectType)
				assert.Equal(t, "viewer", got.Relation)
				assert.Equal(t, domain.AuthzScopeKindProject, got.ScopeKind)
			},
		},
		{
			name: "ok team grant",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeTeam,
				PrincipalID:   teamID,
				Relation:      "editor",
				ExpiresAt:     &future,
			},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				expectActiveTeamPrincipal(s, teamID)
				s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, a *domain.AuthzAssignment) error {
						a.ID = "asgn_test02"
						a.CreatedAt = time.Now()
						a.UpdatedAt = a.CreatedAt
						return nil
					})
				s.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil)
			},
			check: func(t *testing.T, got *domain.AuthzAssignment) {
				assert.Equal(t, domain.AuthzPrincipalTypeTeam, got.PrincipalType)
				assert.Equal(t, teamID, got.PrincipalID)
				assert.Equal(t, "editor", got.Relation)
				require.NotNil(t, got.ExpiresAt)
			},
		},
		{
			name: "reject relation team",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				Relation:      "team",
			},
			wantErr: domain.ErrGrantInvalid(),
		},
		{
			name: "reject sk_proj principal",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeSKProj,
				PrincipalID:   "proj_customer",
				Relation:      "viewer",
			},
			wantErr: domain.ErrGrantInvalid(),
		},
		{
			name: "unknown principal",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				Relation:      "viewer",
			},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetResourceScope(gomock.Any(), userID).
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrGrantPrincipalNotFound(),
		},
		{
			name: "inactive user",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				Relation:      "admin",
			},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetResourceScope(gomock.Any(), userID).Return(&domain.ResourceScope{
					ResourceID:   userID,
					ResourceKind: domain.ResourceKindUser,
					ProjectID:    grantPlatformProjID,
				}, nil)
				s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrGrantPrincipalNotFound(),
		},
		{
			name: "unique conflict",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				Relation:      "viewer",
			},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				expectActiveUserPrincipal(s, userID)
				s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).
					Return(database.NewUniqueError("authz_assignments", "authz_assignments_unique_active", nil))
			},
			wantErr: domain.ErrGrantAlreadyExists(),
		},
		{
			name: "principal id prefix mismatch",
			input: service.CreateGrantInput{
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   teamID,
				Relation:      "viewer",
			},
			wantErr: domain.ErrGrantInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedGrantService(t, grantPlatformProjID, tc.setupStmt)
			got, err := svc.Create(t.Context(), tc.input)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, got)
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

func TestGrantService_Create_EventUsesAssignmentProject(t *testing.T) {
	t.Parallel()

	userID := "user_grant01"
	homeTeam := "team_home"
	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ProjectID: "proj_platform",
		TeamID:    &homeTeam,
	})
	var got *domain.Event
	svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
		expectActiveUserPrincipal(s, userID)
		s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, a *domain.AuthzAssignment) error {
				a.ID = "asgn_test01"
				a.CreatedAt = time.Now()
				a.UpdatedAt = a.CreatedAt
				return nil
			})
		s.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, ev *domain.Event) error {
				got = ev
				return nil
			})
	})
	_, err := svc.Create(ctx, service.CreateGrantInput{
		ProjectID:     "proj_customer",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   userID,
		Relation:      "viewer",
	})
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, domain.EventTypeAuthzGranted, got.EventType)
	assert.Equal(t, domain.EventCategoryAdmin, got.Category)
	assert.Equal(t, "proj_customer", got.ProjectID)
	assert.Nil(t, got.TeamID)
	require.NotNil(t, got.EntityType)
	assert.Equal(t, "authz_assignment", *got.EntityType)
	require.NotNil(t, got.EntityID)
	assert.Equal(t, "asgn_test01", *got.EntityID)
	assert.JSONEq(t, `{"principal_type":"user","principal_id":"user_grant01","relation":"viewer"}`, string(got.Payload))
}

func TestGrantService_Get(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_1").Return(&domain.AuthzAssignment{
				ID:            "asgn_1",
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_grant01",
				ObjectType:    "project",
				Relation:      "viewer",
			}, nil)
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_1")
		require.NoError(t, err)
		assert.Equal(t, "asgn_1", got.ID)
	})

	t.Run("revoked is not found", func(t *testing.T) {
		t.Parallel()
		revoked := time.Now()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_1").Return(&domain.AuthzAssignment{
				ID:        "asgn_1",
				ProjectID: "proj_customer",
				RevokedAt: &revoked,
			}, nil)
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_1")
		require.ErrorIs(t, err, domain.ErrGrantNotFound())
		assert.Nil(t, got)
	})

	t.Run("missing is not found", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_missing").
				Return(nil, database.NewNoRowFoundError(nil))
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_missing")
		require.ErrorIs(t, err, domain.ErrGrantNotFound())
		assert.Nil(t, got)
	})

	t.Run("sk_proj setup is not found", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_setup").Return(
				domain.NewSKProjProjectSetupAssignment("proj_customer"), nil)
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_setup")
		require.ErrorIs(t, err, domain.ErrGrantNotFound())
		assert.Nil(t, got)
	})

	t.Run("owning-team grant is not found", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_own").Return(
				domain.NewClaimTeamAssignment("proj_customer", "team_owner"), nil)
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_own")
		require.ErrorIs(t, err, domain.ErrGrantNotFound())
		assert.Nil(t, got)
	})

	t.Run("expired managed grant is still returned", func(t *testing.T) {
		t.Parallel()
		expired := time.Now().Add(-time.Hour)
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_exp").Return(&domain.AuthzAssignment{
				ID:            "asgn_exp",
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_grant01",
				ObjectType:    "project",
				Relation:      "viewer",
				ExpiresAt:     &expired,
			}, nil)
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_exp")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "asgn_exp", got.ID)
		require.NotNil(t, got.ExpiresAt)
	})

	t.Run("non-project object type is not found", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_user").Return(&domain.AuthzAssignment{
				ID:            "asgn_user",
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_grant01",
				ObjectType:    "user",
				Relation:      "viewer",
			}, nil)
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_user")
		require.ErrorIs(t, err, domain.ErrGrantNotFound())
		assert.Nil(t, got)
	})
}

func TestGrantService_Revoke(t *testing.T) {
	t.Parallel()

	t.Run("ok emits authz.revoked", func(t *testing.T) {
		t.Parallel()
		var got *domain.Event
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_1").Return(&domain.AuthzAssignment{
				ID:            "asgn_1",
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_grant01",
				ObjectType:    "project",
				Relation:      "viewer",
			}, nil)
			s.EXPECT().RevokeAuthzAssignment(gomock.Any(), "proj_customer", "asgn_1").Return(nil)
			s.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, e *domain.Event) error {
					got = e
					return nil
				})
		})
		require.NoError(t, svc.Revoke(t.Context(), "proj_customer", "asgn_1"))
		require.NotNil(t, got)
		assert.Equal(t, domain.EventTypeAuthzRevoked, got.EventType)
		assert.Equal(t, "proj_customer", got.ProjectID)
		require.NotNil(t, got.EntityType)
		assert.Equal(t, "authz_assignment", *got.EntityType)
		require.NotNil(t, got.EntityID)
		assert.Equal(t, "asgn_1", *got.EntityID)
		assert.JSONEq(t, `{"principal_type":"user","principal_id":"user_grant01","relation":"viewer"}`, string(got.Payload))
	})

	t.Run("already revoked is not found", func(t *testing.T) {
		t.Parallel()
		revoked := time.Now()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_1").Return(&domain.AuthzAssignment{
				ID:        "asgn_1",
				ProjectID: "proj_customer",
				RevokedAt: &revoked,
			}, nil)
		})
		require.ErrorIs(t, svc.Revoke(t.Context(), "proj_customer", "asgn_1"), domain.ErrGrantNotFound())
	})

	t.Run("sk_proj setup is not found", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_setup").Return(
				domain.NewSKProjProjectSetupAssignment("proj_customer"), nil)
		})
		require.ErrorIs(t, svc.Revoke(t.Context(), "proj_customer", "asgn_setup"), domain.ErrGrantNotFound())
	})

	t.Run("owning-team grant is not found", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_own").Return(
				domain.NewClaimTeamAssignment("proj_customer", "team_owner"), nil)
		})
		require.ErrorIs(t, svc.Revoke(t.Context(), "proj_customer", "asgn_own"), domain.ErrGrantNotFound())
	})

	t.Run("non-project object type is not found", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().GetAuthzAssignment(gomock.Any(), "proj_customer", "asgn_user").Return(&domain.AuthzAssignment{
				ID:            "asgn_user",
				ProjectID:     "proj_customer",
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   "user_grant01",
				ObjectType:    "user",
				Relation:      "viewer",
			}, nil)
		})
		require.ErrorIs(t, svc.Revoke(t.Context(), "proj_customer", "asgn_user"), domain.ErrGrantNotFound())
	})
}

func expectActiveUserPrincipal(s *servicemocks.MockAllStatements, userID string) {
	s.EXPECT().GetResourceScope(gomock.Any(), userID).Return(&domain.ResourceScope{
		ResourceID:   userID,
		ResourceKind: domain.ResourceKindUser,
		ProjectID:    grantPlatformProjID,
	}, nil)
	s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.User{
		ProjectID: grantPlatformProjID,
		ID:        userID,
		Metadata:  domain.UserMetadata{Status: domain.UserStatusActive},
	}, nil)
}

func expectActiveTeamPrincipal(s *servicemocks.MockAllStatements, teamID string) {
	s.EXPECT().GetResourceScope(gomock.Any(), teamID).Return(&domain.ResourceScope{
		ResourceID:   teamID,
		ResourceKind: domain.ResourceKindTeam,
		ProjectID:    grantPlatformProjID,
	}, nil)
	s.EXPECT().GetTeam(gomock.Any(), gomock.Any()).Return(&domain.Team{
		ProjectID: grantPlatformProjID,
		ID:        teamID,
		Status:    domain.TeamStatusActive,
	}, nil)
}

func newMockedGrantService(t *testing.T, platformProjectID string, setupStmt func(*servicemocks.MockAllStatements)) *service.GrantService {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	if setupStmt != nil {
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
		setupStmt(statements)
	}

	return service.NewGrantService(service.NewPool(pool), platformProjectID)
}
