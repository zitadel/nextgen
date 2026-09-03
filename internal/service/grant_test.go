package service_test

import (
	"context"
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
		check     func(t *testing.T, got *service.Grant)
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
				expectHydrateUser(s, userID)
			},
			check: func(t *testing.T, got *service.Grant) {
				assert.Equal(t, "asgn_test01", got.Assignment.ID)
				assert.Equal(t, "proj_customer", got.Assignment.ProjectID)
				assert.Equal(t, domain.AuthzPrincipalTypeUser, got.Assignment.PrincipalType)
				assert.Equal(t, userID, got.Assignment.PrincipalID)
				assert.Equal(t, "project", got.Assignment.ObjectType)
				assert.Equal(t, "viewer", got.Assignment.Relation)
				assert.Equal(t, domain.AuthzScopeKindProject, got.Assignment.ScopeKind)
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
				expectHydrateTeam(s, teamID)
			},
			check: func(t *testing.T, got *service.Grant) {
				assert.Equal(t, domain.AuthzPrincipalTypeTeam, got.Assignment.PrincipalType)
				assert.Equal(t, teamID, got.Assignment.PrincipalID)
				assert.Equal(t, "editor", got.Assignment.Relation)
				require.NotNil(t, got.Assignment.ExpiresAt)
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
			expectHydrateUser(s, "user_grant01")
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_1")
		require.NoError(t, err)
		assert.Equal(t, "asgn_1", got.Assignment.ID)
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
			expectHydrateUser(s, "user_grant01")
		})
		got, err := svc.Get(t.Context(), "proj_customer", "asgn_exp")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "asgn_exp", got.Assignment.ID)
		require.NotNil(t, got.Assignment.ExpiresAt)
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
		var emitted domain.EventType
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
					emitted = e.EventType
					return nil
				})
		})
		require.NoError(t, svc.Revoke(t.Context(), "proj_customer", "asgn_1"))
		assert.Equal(t, domain.EventTypeAuthzRevoked, emitted)
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

func expectHydrateUser(s *servicemocks.MockAllStatements, userID string) {
	s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.User]{
		Items: []*domain.User{{ID: userID}},
	}, nil)
}

func expectHydrateTeam(s *servicemocks.MockAllStatements, teamID string) {
	s.EXPECT().ListTeams(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.Team]{
		Items: []*domain.Team{{ID: teamID}},
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

func TestGrantService_List(t *testing.T) {
	t.Parallel()

	userID := "user_grant_list"
	teamID := "team_grant_list"
	now := time.Now().UTC().Truncate(time.Second)
	expired := now.Add(-time.Hour)

	userAsgn := &domain.AuthzAssignment{
		ID: "asgn_user1", ProjectID: "proj_customer", CatalogID: domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: userID,
		ObjectType: "project", Relation: "viewer", CreatedAt: now,
	}
	teamAsgn := &domain.AuthzAssignment{
		ID: "asgn_team1", ProjectID: "proj_customer", CatalogID: domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeTeam, PrincipalID: teamID,
		ObjectType: "project", Relation: "editor", CreatedAt: now,
	}
	expiredAsgn := &domain.AuthzAssignment{
		ID: "asgn_exp1", ProjectID: "proj_customer", CatalogID: domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "user_gone",
		ObjectType: "project", Relation: "admin", CreatedAt: now, ExpiresAt: &expired,
	}

	t.Run("empty page", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.AuthzAssignment]{}, nil)
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{ProjectID: "proj_customer"})
		require.NoError(t, err)
		assert.Empty(t, got.Grants)
		assert.Empty(t, got.NextPageToken)
	})

	t.Run("mixed page hydrates user and team refs", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.AuthzAssignment]{
				Items:      []*domain.AuthzAssignment{userAsgn, teamAsgn},
				NextCursor: []byte("next"),
			}, nil)
			s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.User]{
				Items: []*domain.User{{
					ID: userID,
					Attributes: []domain.Attribute{
						{Key: "email", Value: "ada@example.com"},
						{Key: "name", Value: "Ada Lovelace"},
					},
				}},
			}, nil)
			s.EXPECT().ListTeams(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.Team]{
				Items: []*domain.Team{{ID: teamID, Name: "Platform admins"}},
			}, nil)
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{ProjectID: "proj_customer"})
		require.NoError(t, err)
		require.Len(t, got.Grants, 2)
		assert.Equal(t, "next", got.NextPageToken)
		require.NotNil(t, got.Grants[0].User)
		assert.Equal(t, userID, got.Grants[0].User.UserID)
		assert.Equal(t, "ada@example.com", got.Grants[0].User.Identifier)
		assert.Equal(t, "email", got.Grants[0].User.IdentifierProperty)
		assert.Equal(t, "Ada Lovelace", got.Grants[0].User.Display)
		assert.Nil(t, got.Grants[0].Team)
		require.NotNil(t, got.Grants[1].Team)
		assert.Equal(t, teamID, got.Grants[1].Team.TeamID)
		assert.Equal(t, "Platform admins", got.Grants[1].Team.Name)
		assert.Nil(t, got.Grants[1].User)
	})

	t.Run("expand off hydrates identity attributes only", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.AuthzAssignment]{
				Items: []*domain.AuthzAssignment{userAsgn},
			}, nil)
			s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, _ *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
					require.Equal(t, domain.IdentityAttributeKeys, opts.AttributeKeys)
					return &database.ListResult[*domain.User]{Items: []*domain.User{{ID: userID}}}, nil
				})
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{ProjectID: "proj_customer"})
		require.NoError(t, err)
		require.Len(t, got.Grants, 1)
		assert.Nil(t, got.Grants[0].Principal)
		require.NotNil(t, got.Grants[0].User)
		assert.Equal(t, userID, got.Grants[0].User.UserID)
	})

	t.Run("expand hydrates full user and team bodies", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.AuthzAssignment]{
				Items: []*domain.AuthzAssignment{userAsgn, teamAsgn},
			}, nil)
			s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, _ *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
					require.Empty(t, opts.AttributeKeys)
					return &database.ListResult[*domain.User]{
						Items: []*domain.User{{
							ID:        userID,
							SchemaURL: "urn:zitadel:schema:user",
							Attributes: []domain.Attribute{
								{Key: "email", Value: "ada@example.com"},
								{Key: "name", Value: "Ada Lovelace"},
							},
						}},
					}, nil
				})
			s.EXPECT().ListTeams(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.Team]{
				Items: []*domain.Team{{ID: teamID, Name: "Platform admins", Status: domain.TeamStatusActive}},
			}, nil)
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{ProjectID: "proj_customer", IncludePrincipal: true})
		require.NoError(t, err)
		require.Len(t, got.Grants, 2)
		require.NotNil(t, got.Grants[0].Principal)
		require.NotNil(t, got.Grants[0].Principal.User)
		assert.Equal(t, userID, got.Grants[0].Principal.User.ID)
		require.NotNil(t, got.Grants[0].User)
		assert.Equal(t, "ada@example.com", got.Grants[0].User.Identifier)
		require.NotNil(t, got.Grants[1].Principal)
		require.NotNil(t, got.Grants[1].Principal.Team)
		assert.Equal(t, teamID, got.Grants[1].Principal.Team.ID)
		require.NotNil(t, got.Grants[1].Team)
		assert.Equal(t, "Platform admins", got.Grants[1].Team.Name)
	})

	t.Run("expand missing principal is requested but empty", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.AuthzAssignment]{
				Items: []*domain.AuthzAssignment{expiredAsgn},
			}, nil)
			s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.User]{}, nil)
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{ProjectID: "proj_customer", IncludePrincipal: true})
		require.NoError(t, err)
		require.Len(t, got.Grants, 1)
		require.NotNil(t, got.Grants[0].Principal)
		assert.Nil(t, got.Grants[0].Principal.User)
		require.NotNil(t, got.Grants[0].User)
		assert.Equal(t, "user_gone", got.Grants[0].User.UserID)
		assert.Empty(t, got.Grants[0].User.Identifier)
	})

	t.Run("missing principal degrades to id-only", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.AuthzAssignment]{
				Items: []*domain.AuthzAssignment{expiredAsgn},
			}, nil)
			s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.User]{}, nil)
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{ProjectID: "proj_customer"})
		require.NoError(t, err)
		require.Len(t, got.Grants, 1)
		require.NotNil(t, got.Grants[0].User)
		assert.Equal(t, "user_gone", got.Grants[0].User.UserID)
		assert.Empty(t, got.Grants[0].User.Identifier)
		assert.Empty(t, got.Grants[0].User.Display)
		assert.Equal(t, expiredAsgn.ID, got.Grants[0].Assignment.ID)
	})

	t.Run("rejects unknown filter field", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {})
		_, err := svc.List(t.Context(), service.ListGrantsRequest{
			ProjectID: "proj_customer",
			Filters:   []service.Filter{{Field: "object_type", Operation: "equals", Value: "project"}},
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrRequestInvalid().Code, err.(domain.Error).Code)
	})

	t.Run("maps invalid page token", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).Return(nil, database.ErrInvalidCursor())
		})
		_, err := svc.List(t.Context(), service.ListGrantsRequest{ProjectID: "proj_customer", PageToken: "nope"})
		require.Error(t, err)
		assert.Equal(t, domain.ErrRequestInvalid().Code, err.(domain.Error).Code)
	})

	t.Run("filters by principal_type", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, opts *database.ListOptions[domain.AuthzAssignmentField]) (*database.ListResult[*domain.AuthzAssignment], error) {
					require.NotNil(t, opts.Filter)
					return &database.ListResult[*domain.AuthzAssignment]{Items: []*domain.AuthzAssignment{userAsgn}}, nil
				})
			s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.User]{
				Items: []*domain.User{{ID: userID}},
			}, nil)
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{
			ProjectID: "proj_customer",
			Filters:   []service.Filter{{Field: "principal_type", Operation: "equals", Value: "user"}},
		})
		require.NoError(t, err)
		require.Len(t, got.Grants, 1)
		assert.Equal(t, userAsgn.ID, got.Grants[0].Assignment.ID)
	})

	t.Run("filters by relation", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListManagedGrants(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, opts *database.ListOptions[domain.AuthzAssignmentField]) (*database.ListResult[*domain.AuthzAssignment], error) {
					require.NotNil(t, opts.Filter)
					return &database.ListResult[*domain.AuthzAssignment]{Items: []*domain.AuthzAssignment{teamAsgn}}, nil
				})
			s.EXPECT().ListTeams(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.Team]{
				Items: []*domain.Team{{ID: teamID, Name: "Platform admins"}},
			}, nil)
		})
		got, err := svc.List(t.Context(), service.ListGrantsRequest{
			ProjectID: "proj_customer",
			Filters:   []service.Filter{{Field: "relation", Operation: "equals", Value: "editor"}},
		})
		require.NoError(t, err)
		require.Len(t, got.Grants, 1)
		assert.Equal(t, teamAsgn.ID, got.Grants[0].Assignment.ID)
		require.NotNil(t, got.Grants[0].Team)
		assert.Equal(t, "Platform admins", got.Grants[0].Team.Name)
	})

	t.Run("rejects missing project_id", func(t *testing.T) {
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {})
		_, err := svc.List(t.Context(), service.ListGrantsRequest{})
		require.Error(t, err)
		assert.Equal(t, domain.ErrGrantInvalid().Code, err.(domain.Error).Code)
	})
}
