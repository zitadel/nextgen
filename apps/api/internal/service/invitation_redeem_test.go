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

func expectUserHome(s *servicemocks.MockAllStatements, userID, projectID string) {
	s.EXPECT().GetResourceScope(gomock.Any(), userID).Return(&domain.ResourceScope{
		ResourceID:   userID,
		ResourceKind: domain.ResourceKindUser,
		ProjectID:    projectID,
	}, nil)
}

// expectInactiveUser is a user whose home resolves but who is no longer active.
func expectInactiveUser(s *servicemocks.MockAllStatements, userID string) {
	expectUserHome(s, userID, grantPlatformProjID)
	s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
}

const invitationToken = "token_plain"

func pendingInvitation(createdBy *string) *domain.Invitation {
	return &domain.Invitation{
		ProjectID:     invitationProjectID,
		ID:            "inv_1",
		Type:          domain.InvitationTypeProjectMember,
		ProjectMember: &domain.InvitationProjectMember{Relation: "admin"},
		Status:        domain.InvitationStatusPending,
		CreatedBy:     createdBy,
		ExpiresAt:     time.Now().Add(time.Hour),
		JourneyID:     "journey_1",
		TokenHash:     domain.HashSecret(invitationToken),
	}
}

func expectInvitationByToken(s *servicemocks.MockAllStatements, entity *domain.Invitation) {
	s.EXPECT().GetInvitationByTokenHash(gomock.Any(), domain.HashSecret(invitationToken)).Return(entity, nil)
}

// expectStatusChange expects the guarded write and returns its row as storage would.
func expectStatusChange(s *servicemocks.MockAllStatements, entity *domain.Invitation, status domain.InvitationStatus, respondedBy string) {
	s.EXPECT().ChangeInvitationStatus(gomock.Any(), invitationProjectID, entity.ID, status, respondedBy, gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ string, status domain.InvitationStatus, respondedBy string, now time.Time) (*domain.Invitation, error) {
			changed := *entity
			changed.Status = status
			if status == domain.InvitationStatusAccepted {
				changed.EncryptedMetadata = nil
			}
			changed.RespondedBy = &respondedBy
			changed.RespondedAt = &now
			return &changed, nil
		})
}

// projectRoles answers each user's strongest role on the invitation's project
// from roles; a user it does not name holds none.
func projectRoles(roles map[string]string) service.ProjectRoleCheck {
	return func(_ context.Context, _ service.AllStatements, _, userID string) (string, error) {
		return roles[userID], nil
	}
}

func TestInvitationService_Lookup(t *testing.T) {
	t.Parallel()

	t.Run("returns a pending invitation with its project's name", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		expectInvitationByToken(s, pendingInvitation(new("user_admin")))
		s.EXPECT().GetProjectByID(gomock.Any(), invitationProjectID).Return(&domain.Project{ID: invitationProjectID, Name: "Acme"}, nil)

		got, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.NoError(t, err)
		assert.Equal(t, "Acme", got.ProjectName)
		assert.Equal(t, "inv_1", got.ID)
		require.NotNil(t, got.Inviter)
		assert.Equal(t, "Ada Lovelace", got.Inviter.Display)
		assert.Empty(t, got.HeldRole, "a colleague without access can accept")
	})

	t.Run("names the role a user with access already holds", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationServiceChecking(t, grantPlatformProjID, projectRoles(map[string]string{"user_colleague": "editor"}))
		expectActiveUserPrincipal(s, "user_colleague")
		expectInvitationByToken(s, pendingInvitation(nil))
		s.EXPECT().GetProjectByID(gomock.Any(), invitationProjectID).Return(&domain.Project{ID: invitationProjectID, Name: "Acme"}, nil)

		got, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.NoError(t, err)
		assert.Equal(t, "editor", got.HeldRole)
	})

	t.Run("an inviter that no longer resolves degrades to its id", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		expectInvitationByToken(s, pendingInvitation(new("user_gone")))
		s.EXPECT().GetProjectByID(gomock.Any(), invitationProjectID).Return(&domain.Project{ID: invitationProjectID, Name: "Acme"}, nil)

		got, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.NoError(t, err)
		assert.Equal(t, &domain.UserRef{UserID: "user_gone"}, got.Inviter)
	})

	t.Run("a project secret's invitation names no inviter", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		expectInvitationByToken(s, pendingInvitation(nil))
		s.EXPECT().GetProjectByID(gomock.Any(), invitationProjectID).Return(&domain.Project{ID: invitationProjectID, Name: "Acme"}, nil)

		got, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.NoError(t, err)
		assert.Nil(t, got.Inviter)
	})

	t.Run("an unknown token", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		s.EXPECT().GetInvitationByTokenHash(gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
		_, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.ErrorIs(t, err, domain.ErrInvitationNotFound())
	})

	t.Run("an expired invitation", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		expired := pendingInvitation(nil)
		expired.ExpiresAt = time.Now().Add(-time.Minute)
		expectInvitationByToken(s, expired)
		_, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.ErrorIs(t, err, domain.ErrInvitationNotPending())
	})

	t.Run("an inviter homed in the invitation's project", func(t *testing.T) {
		t.Parallel()
		svc, s, refs := newMockedInvitationServiceWithRefs(t)
		expectActiveUserPrincipal(s, "user_colleague")
		expectInvitationByToken(s, pendingInvitation(new("user_local")))
		s.EXPECT().GetProjectByID(gomock.Any(), invitationProjectID).Return(&domain.Project{ID: invitationProjectID, Name: "Acme"}, nil)

		got, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.NoError(t, err)
		assert.Equal(t, "Grace Hopper", got.Inviter.Display)
		// Not a platform user, so found in the invitation's project.
		assert.Equal(t, [][2]any{
			{grantPlatformProjID, []string{"user_local"}},
			{invitationProjectID, []string{"user_local"}},
		}, refs.calls)
	})

	t.Run("a deactivated user", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		expectInactiveUser(s, "user_colleague")

		_, err := svc.Lookup(t.Context(), invitationToken, "user_colleague")
		require.ErrorIs(t, err, domain.ErrAuthUnauthorized(nil))
	})
}

func TestInvitationService_Accept(t *testing.T) {
	t.Parallel()

	const accepter = "user_colleague"
	expired := time.Now().Add(-time.Hour)
	managed := func(id, relation string, expiresAt *time.Time) *domain.AuthzAssignment {
		asgn := &domain.AuthzAssignment{
			ID:            id,
			ProjectID:     invitationProjectID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   accepter,
			ObjectType:    "project",
			Relation:      relation,
			ExpiresAt:     expiresAt,
		}
		asgn.ApplyScope(domain.NewProjectAssignmentScope())
		return asgn
	}

	tests := []struct {
		name string
		held []*domain.AuthzAssignment
		// revokes is the id of the expired grant the adapter replaces.
		revokes string
		// revokeErr is what revoking it returns.
		revokeErr  error
		wantCreate bool
		wantEvents []domain.EventType
	}{
		{
			name:       "no grant yet: creates one",
			wantCreate: true,
			wantEvents: []domain.EventType{domain.EventTypeAuthzGranted, domain.EventTypeInvitationAccepted},
		},
		{
			name:       "an identical expired grant: revoked and created again",
			held:       []*domain.AuthzAssignment{managed("asgn_admin", "admin", &expired)},
			revokes:    "asgn_admin",
			wantCreate: true,
			wantEvents: []domain.EventType{domain.EventTypeAuthzRevoked, domain.EventTypeAuthzGranted, domain.EventTypeInvitationAccepted},
		},
		{
			name:       "an expired grant an administrator revoked meanwhile: created again",
			held:       []*domain.AuthzAssignment{managed("asgn_admin", "admin", &expired)},
			revokes:    "asgn_admin",
			revokeErr:  database.NewNoRowFoundError(nil),
			wantCreate: true,
			wantEvents: []domain.EventType{domain.EventTypeAuthzGranted, domain.EventTypeInvitationAccepted},
		},
		{
			// The refusal read expiry by the database's clock; this clock may
			// still be before it, and the row still blocks the write.
			name:       "a grant this clock thinks active but the role check didn't count: revoked",
			held:       []*domain.AuthzAssignment{managed("asgn_admin", "admin", new(time.Now().Add(time.Minute)))},
			revokes:    "asgn_admin",
			wantCreate: true,
			wantEvents: []domain.EventType{domain.EventTypeAuthzRevoked, domain.EventTypeAuthzGranted, domain.EventTypeInvitationAccepted},
		},
		{
			name: "a delegated grant of the same relation: left alone",
			held: []*domain.AuthzAssignment{func() *domain.AuthzAssignment {
				asgn := managed("asgn_delegated", "admin", &expired)
				asgn.DelegationID = new("dlg_1")
				return asgn
			}()},
			wantCreate: true,
			wantEvents: []domain.EventType{domain.EventTypeAuthzGranted, domain.EventTypeInvitationAccepted},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, s, _, events := newMockedInvitationService(t, grantPlatformProjID)
			entity := pendingInvitation(new("user_admin"))
			expectActiveUserPrincipal(s, accepter)
			expectInvitationByToken(s, entity)
			// Accept locks first; a grant write locks again.
			s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil).MinTimes(1)
			expectClaimedProject(s, invitationProjectID)
			expectActiveUserPrincipal(s, accepter)
			s.EXPECT().ListAuthzAssignments(gomock.Any(), invitationProjectID, domain.AuthzPrincipalTypeUser, accepter, false).Return(tc.held, nil)
			if tc.revokes != "" {
				s.EXPECT().RevokeAuthzAssignment(gomock.Any(), invitationProjectID, tc.revokes).Return(tc.revokeErr)
			}
			if tc.wantCreate {
				s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, asgn *domain.AuthzAssignment) error {
						assert.Equal(t, accepter, asgn.PrincipalID)
						assert.Equal(t, domain.AuthzPrincipalTypeUser, asgn.PrincipalType)
						assert.Equal(t, "admin", asgn.Relation)
						assert.Nil(t, asgn.ExpiresAt)
						asgn.ID = "asgn_new"
						return nil
					})
			}
			expectStatusChange(s, entity, domain.InvitationStatusAccepted, accepter)

			got, err := svc.Accept(t.Context(), invitationToken, accepter)
			require.NoError(t, err)
			assert.Equal(t, domain.InvitationStatusAccepted, got.Status)
			assert.Equal(t, new(accepter), got.RespondedBy)
			assert.Nil(t, got.Metadata)

			types := make([]domain.EventType, 0, len(*events))
			for _, event := range *events {
				types = append(types, event.EventType)
			}
			require.Equal(t, tc.wantEvents, types)
			accepted := invitationEvent[domain.InvitationAcceptedPayload](t, (*events)[len(*events)-1], domain.EventTypeInvitationAccepted, "inv_1")
			assert.Equal(t, domain.InvitationAcceptedPayload{
				Type:          "project_member",
				ProjectMember: &domain.InvitationProjectMemberPayload{Relation: "admin"},
				JourneyID:     "journey_1",
				UserID:        accepter,
			}, accepted)
		})
	}

	refusals := []struct {
		name      string
		createdBy *string
		// inactive refuses the user before the token is read.
		inactive bool
		// roles are the users' roles on the project; none by default, so the
		// inviter no longer administers it.
		roles   map[string]string
		setup   func(s *servicemocks.MockAllStatements, entity *domain.Invitation)
		wantErr error
	}{
		{
			name:      "the inviter accepting their own invitation",
			createdBy: new(accepter),
			wantErr:   domain.ErrInvitationSelfAccept(),
		},
		{
			name:      "an unclaimed project",
			createdBy: new("user_admin"),
			setup: func(s *servicemocks.MockAllStatements, _ *domain.Invitation) {
				s.EXPECT().GetProjectByID(gomock.Any(), invitationProjectID).Return(&domain.Project{ID: invitationProjectID}, nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), invitationProjectID).Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInvitationProjectUnclaimed(),
		},
		{
			name:      "an inviter who no longer holds admin",
			createdBy: new("user_admin"),
			setup: func(s *servicemocks.MockAllStatements, _ *domain.Invitation) {
				expectClaimedProject(s, invitationProjectID)
			},
			wantErr: domain.ErrInvitationInviterNotAdmin(),
		},
		{
			name:     "an accepting user no longer active",
			inactive: true,
			wantErr:  domain.ErrAuthUnauthorized(nil),
		},
		{
			name: "an accepting user deactivated after the redeem check",
			setup: func(s *servicemocks.MockAllStatements, entity *domain.Invitation) {
				expectClaimedProject(s, invitationProjectID)
				expectStatusChange(s, entity, domain.InvitationStatusAccepted, accepter)
				s.EXPECT().GetResourceScope(gomock.Any(), accepter).Return(&domain.ResourceScope{
					ResourceID:   accepter,
					ResourceKind: domain.ResourceKindUser,
					ProjectID:    grantPlatformProjID,
				}, nil)
				s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrAuthUnauthorized(nil),
		},
		{
			name: "a decline or accept that won the race",
			setup: func(s *servicemocks.MockAllStatements, entity *domain.Invitation) {
				// The loser misses on the status change and writes no grant.
				expectClaimedProject(s, invitationProjectID)
				s.EXPECT().ChangeInvitationStatus(gomock.Any(), invitationProjectID, entity.ID, domain.InvitationStatusAccepted, gomock.Any(), gomock.Any()).
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInvitationNotPending(),
		},
		{
			// No status change and no grant: the link stays for its invitee.
			name:      "a user who already has access to the project",
			createdBy: new("user_admin"),
			roles:     map[string]string{"user_admin": "admin", accepter: "viewer"},
			wantErr:   domain.ErrInvitationAlreadyMember("viewer"),
		},
	}
	for _, tc := range refusals {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, s, _, _ := newMockedInvitationServiceChecking(t, grantPlatformProjID, projectRoles(tc.roles))
			entity := pendingInvitation(tc.createdBy)
			if tc.inactive {
				expectInactiveUser(s, accepter)
			} else {
				expectActiveUserPrincipal(s, accepter)
				expectInvitationByToken(s, entity)
			}
			// A self-accept is refused before the lock.
			s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil).AnyTimes()
			if tc.setup != nil {
				tc.setup(s, entity)
			}
			_, err := svc.Accept(t.Context(), invitationToken, accepter)
			require.ErrorIs(t, err, tc.wantErr)
		})
	}

	t.Run("a server without a platform project", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _ := newMockedInvitationService(t, "")
		_, err := svc.Accept(t.Context(), invitationToken, accepter)
		require.ErrorIs(t, err, domain.ErrInvitationPlatformRequired())
	})

	t.Run("an invitation a project secret created skips the inviter check", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationServiceChecking(t, grantPlatformProjID, func(_ context.Context, _ service.AllStatements, _, userID string) (string, error) {
			// Only the redeemer is checked.
			if userID != accepter {
				t.Errorf("the role check ran for %s on an invitation without a creator", userID)
			}
			return "", nil
		})
		entity := pendingInvitation(nil)
		expectActiveUserPrincipal(s, accepter)
		expectInvitationByToken(s, entity)
		s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil).Times(2)
		expectClaimedProject(s, invitationProjectID)
		expectActiveUserPrincipal(s, accepter)
		s.EXPECT().ListAuthzAssignments(gomock.Any(), invitationProjectID, domain.AuthzPrincipalTypeUser, accepter, false).Return(nil, nil)
		s.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).Return(nil)
		expectStatusChange(s, entity, domain.InvitationStatusAccepted, accepter)

		_, err := svc.Accept(t.Context(), invitationToken, accepter)
		require.NoError(t, err)
	})
}

func TestInvitationService_Reject(t *testing.T) {
	t.Parallel()

	t.Run("declines a pending invitation", func(t *testing.T) {
		t.Parallel()
		svc, s, _, events := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		entity := pendingInvitation(new("user_admin"))
		entity.EncryptedMetadata = new("ciphertext")
		expectInvitationByToken(s, entity)
		s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
		expectStatusChange(s, entity, domain.InvitationStatusRejected, "user_colleague")

		got, err := svc.Reject(t.Context(), invitationToken, "user_colleague")
		require.NoError(t, err)
		assert.Equal(t, domain.InvitationStatusRejected, got.Status)
		assert.Equal(t, new("user_colleague"), got.RespondedBy)
		assert.NotNil(t, got.RespondedAt)

		require.Len(t, *events, 1)
		rejected := invitationEvent[domain.InvitationRejectedPayload](t, (*events)[0], domain.EventTypeInvitationRejected, "inv_1")
		assert.Equal(t, domain.InvitationRejectedPayload{JourneyID: "journey_1", UserID: "user_colleague"}, rejected)
	})

	t.Run("rechecks expiry at the time the lock was taken", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		entity := pendingInvitation(new("user_admin"))
		expectInvitationByToken(s, entity)
		var locked time.Time
		s.EXPECT().LockProject(gomock.Any(), invitationProjectID).DoAndReturn(func(context.Context, string) error {
			// The lock waits on a racing accept.
			time.Sleep(time.Millisecond)
			locked = time.Now()
			return nil
		})
		s.EXPECT().ChangeInvitationStatus(gomock.Any(), invitationProjectID, entity.ID, domain.InvitationStatusRejected, "user_colleague", gomock.Any()).DoAndReturn(
			func(_ context.Context, _, _ string, status domain.InvitationStatus, respondedBy string, now time.Time) (*domain.Invitation, error) {
				assert.False(t, now.Before(locked), "the status change got a time read before the lock")
				changed := *entity
				changed.Status = status
				changed.RespondedBy = &respondedBy
				changed.RespondedAt = &now
				return &changed, nil
			})

		_, err := svc.Reject(t.Context(), invitationToken, "user_colleague")
		require.NoError(t, err)
	})

	t.Run("the inviter declining their own invitation", func(t *testing.T) {
		t.Parallel()
		svc, s, _, events := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_admin")
		expectInvitationByToken(s, pendingInvitation(new("user_admin")))

		_, err := svc.Reject(t.Context(), invitationToken, "user_admin")
		require.ErrorIs(t, err, domain.ErrInvitationSelfReject())
		assert.Empty(t, *events)
	})

	t.Run("a user who already has access to the project", func(t *testing.T) {
		t.Parallel()
		svc, s, _, events := newMockedInvitationServiceChecking(t, grantPlatformProjID, projectRoles(map[string]string{"user_colleague": "admin"}))
		expectActiveUserPrincipal(s, "user_colleague")
		expectInvitationByToken(s, pendingInvitation(new("user_admin")))
		s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)

		// No status change: the link stays pending for its invitee.
		_, err := svc.Reject(t.Context(), invitationToken, "user_colleague")
		require.ErrorIs(t, err, domain.ErrInvitationAlreadyMember("admin"))
		assert.Empty(t, *events)
	})

	t.Run("a finished invitation", func(t *testing.T) {
		t.Parallel()
		svc, s, _, events := newMockedInvitationService(t, grantPlatformProjID)
		expectActiveUserPrincipal(s, "user_colleague")
		entity := pendingInvitation(nil)
		entity.Status = domain.InvitationStatusAccepted
		expectInvitationByToken(s, entity)

		_, err := svc.Reject(t.Context(), invitationToken, "user_colleague")
		require.ErrorIs(t, err, domain.ErrInvitationNotPending())
		assert.Empty(t, *events)
	})

	t.Run("a deactivated user", func(t *testing.T) {
		t.Parallel()
		svc, s, _, events := newMockedInvitationService(t, grantPlatformProjID)
		expectInactiveUser(s, "user_colleague")

		_, err := svc.Reject(t.Context(), invitationToken, "user_colleague")
		require.ErrorIs(t, err, domain.ErrAuthUnauthorized(nil))
		assert.Empty(t, *events)
	})
}
