package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	invitationProjectID = "proj_customer"
	invitationKeyID     = "enc_invitation_key"
	invitationConsole   = "https://console.example.com/ui/console"
)

func newMockedInvitationService(t *testing.T, platformProjectID string) (*service.InvitationService, *servicemocks.MockAllStatements, *servicemocks.MockKeyService, *[]*domain.Event) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()
	events := new([]*domain.Event)
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, event *domain.Event) error {
			*events = append(*events, event)
			return nil
		},
	).AnyTimes()
	keys := servicemocks.NewMockKeyService(ctrl)
	return service.NewInvitationService(service.NewPool(pool), keys, invitationConsole, platformProjectID), statements, keys, events
}

// invitationEvent decodes one recorded event's payload into T.
func invitationEvent[T any](t *testing.T, event *domain.Event, typ domain.EventType, entityID string) T {
	t.Helper()
	assert.Equal(t, typ, event.EventType)
	assert.Equal(t, domain.EventCategoryAdmin, event.Category)
	require.NotNil(t, event.EntityType)
	assert.Equal(t, "invitation", *event.EntityType)
	require.NotNil(t, event.EntityID)
	assert.Equal(t, entityID, *event.EntityID)
	var payload T
	require.NoError(t, json.Unmarshal(event.Payload, &payload))
	return payload
}

func encryptedInvitationMetadata(t *testing.T, name string) *string {
	t.Helper()
	plain, err := json.Marshal(domain.InvitationMetadata{Name: name})
	require.NoError(t, err)
	encrypted, err := testCrypter(invitationKeyID).Encrypt(string(plain))
	require.NoError(t, err)
	return &encrypted
}

func projectMemberInput(relation string) service.CreateInvitationInput {
	return service.CreateInvitationInput{
		ProjectID:     invitationProjectID,
		Type:          domain.InvitationTypeProjectMember,
		ProjectMember: &domain.InvitationProjectMember{Relation: relation},
	}
}

// expectInvitationInsert expects the locked count and the insert, and hands
// back the row the service wrote.
func expectInvitationInsert(s *servicemocks.MockAllStatements, pending int64) *domain.Invitation {
	written := new(domain.Invitation)
	s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
	s.EXPECT().CountPendingInvitations(gomock.Any(), invitationProjectID, gomock.Any()).Return(pending, nil)
	s.EXPECT().CreateInvitation(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, entity *domain.Invitation) error {
			entity.ID = "inv_new"
			entity.Status = domain.InvitationStatusPending
			entity.CreatedAt = time.Now()
			*written = *entity
			return nil
		})
	return written
}

func TestInvitationService_Create(t *testing.T) {
	t.Parallel()

	t.Run("mints a link, encrypts the metadata and records the creator", func(t *testing.T) {
		t.Parallel()
		svc, s, keys, events := newMockedInvitationService(t, grantPlatformProjID)
		expectClaimedProject(s, invitationProjectID)
		keys.EXPECT().GetProjectCrypter(gomock.Any(), invitationProjectID, domain.EncryptionKeyPurposeSecret).Return(testCrypter(invitationKeyID), nil)
		written := expectInvitationInsert(s, 0)

		userID := "user_admin"
		ctx := audit.WithActorContext(t.Context(), audit.ActorContext{ActorID: &userID, ActorType: new(domain.EventActorTypeHuman)})
		input := projectMemberInput("editor")
		input.Metadata = &domain.InvitationMetadata{Name: "  John Doe "}
		got, err := svc.Create(ctx, input)
		require.NoError(t, err)

		token, ok := strings.CutPrefix(got.Link, invitationConsole+"/invitations/accept#token=")
		require.True(t, ok, got.Link)
		assert.Equal(t, domain.HashSecret(token), written.TokenHash)
		assert.Equal(t, "editor", written.ProjectMember.Relation)
		assert.NotEmpty(t, written.JourneyID)
		assert.WithinDuration(t, time.Now().Add(domain.InvitationExpiration), written.ExpiresAt, time.Minute)
		assert.Equal(t, &userID, written.CreatedBy)
		assert.Equal(t, new(domain.EventActorTypeHuman), written.CreatedByType)

		require.NotNil(t, written.EncryptedMetadata)
		assert.NotContains(t, *written.EncryptedMetadata, "John")
		plain, err := testCrypter(invitationKeyID).Decrypt(*written.EncryptedMetadata)
		require.NoError(t, err)
		assert.JSONEq(t, `{"name":"John Doe"}`, plain)
		assert.Equal(t, &domain.InvitationMetadata{Name: "John Doe"}, got.Metadata)

		require.Len(t, *events, 1)
		assert.NotContains(t, string((*events)[0].Payload), "John")
		assert.NotContains(t, string((*events)[0].Payload), token)
		created := invitationEvent[domain.InvitationCreatedPayload](t, (*events)[0], domain.EventTypeInvitationCreated, "inv_new")
		assert.Equal(t, "project_member", created.Type)
		require.NotNil(t, created.ProjectMember)
		assert.Equal(t, "editor", created.ProjectMember.Relation)
		assert.Equal(t, written.JourneyID, created.JourneyID)
		assert.Empty(t, created.ReplacesInvitationID)
	})

	t.Run("the platform project needs no claim", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, invitationProjectID)
		expectInvitationInsert(s, 0)

		_, err := svc.Create(t.Context(), projectMemberInput("admin"))
		require.NoError(t, err)
	})

	refusals := []struct {
		name     string
		platform string
		input    service.CreateInvitationInput
		setup    func(s *servicemocks.MockAllStatements)
		wantErr  error
	}{
		{
			name:     "team_member is not implemented",
			platform: grantPlatformProjID,
			input:    service.CreateInvitationInput{ProjectID: invitationProjectID, Type: "team_member"},
			wantErr:  domain.ErrNotImplemented(),
		},
		{
			name:     "unknown relation",
			platform: grantPlatformProjID,
			input:    projectMemberInput("owner"),
			wantErr:  domain.ErrInvitationInvalid(),
		},
		{
			name:     "blank metadata name",
			platform: grantPlatformProjID,
			input: func() service.CreateInvitationInput {
				in := projectMemberInput("viewer")
				in.Metadata = &domain.InvitationMetadata{Name: "   "}
				return in
			}(),
			wantErr: domain.ErrInvitationInvalid(),
		},
		{
			name:     "no platform project",
			platform: "",
			input:    projectMemberInput("viewer"),
			wantErr:  domain.ErrInvitationPlatformRequired(),
		},
		{
			name:     "unclaimed project",
			platform: grantPlatformProjID,
			input:    projectMemberInput("viewer"),
			setup: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetProjectByID(gomock.Any(), invitationProjectID).Return(&domain.Project{ID: invitationProjectID}, nil)
				s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), invitationProjectID).Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInvitationProjectUnclaimed(),
		},
		{
			name:     "pending cap reached",
			platform: grantPlatformProjID,
			input:    projectMemberInput("viewer"),
			setup: func(s *servicemocks.MockAllStatements) {
				expectClaimedProject(s, invitationProjectID)
				s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
				s.EXPECT().CountPendingInvitations(gomock.Any(), invitationProjectID, gomock.Any()).Return(int64(service.MaxPendingInvitations), nil)
			},
			wantErr: domain.ErrInvitationPendingLimit(),
		},
	}
	for _, tc := range refusals {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, s, _, _ := newMockedInvitationService(t, tc.platform)
			if tc.setup != nil {
				tc.setup(s)
			}
			got, err := svc.Create(t.Context(), tc.input)
			require.ErrorIs(t, err, tc.wantErr)
			assert.Nil(t, got)
		})
	}
}

func TestInvitationService_Replace(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	original := func(status domain.InvitationStatus, expiresAt time.Time, metadata *string) *domain.Invitation {
		return &domain.Invitation{
			ProjectID:         invitationProjectID,
			ID:                "inv_old",
			Type:              domain.InvitationTypeProjectMember,
			ProjectMember:     &domain.InvitationProjectMember{Relation: "viewer"},
			EncryptedMetadata: metadata,
			Status:            status,
			ExpiresAt:         expiresAt,
			JourneyID:         "journey_old",
		}
	}
	replaceInput := func() service.CreateInvitationInput {
		in := projectMemberInput("editor")
		in.ReplacesInvitationID = "inv_old"
		return in
	}

	t.Run("deletes the original and moves its journey and metadata", func(t *testing.T) {
		t.Parallel()
		svc, s, keys, events := newMockedInvitationService(t, grantPlatformProjID)
		keys.EXPECT().GetCrypter(gomock.Any(), invitationKeyID, jose.A256GCM).Return(testCrypter(invitationKeyID), nil)
		expectClaimedProject(s, invitationProjectID)
		metadata := encryptedInvitationMetadata(t, "John Doe")
		s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
		s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_old").
			Return(original(domain.InvitationStatusPending, now.Add(time.Hour), metadata), nil).Times(2)
		// The delete runs before the count, so a replace never trips the cap.
		gomock.InOrder(
			s.EXPECT().DeleteUnacceptedInvitation(gomock.Any(), invitationProjectID, "inv_old").Return(nil),
			s.EXPECT().CountPendingInvitations(gomock.Any(), invitationProjectID, gomock.Any()).Return(int64(service.MaxPendingInvitations-1), nil),
		)
		var written domain.Invitation
		s.EXPECT().CreateInvitation(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, entity *domain.Invitation) error {
				entity.ID = "inv_new"
				written = *entity
				return nil
			})

		got, err := svc.Create(t.Context(), replaceInput())
		require.NoError(t, err)
		assert.Equal(t, &domain.InvitationMetadata{Name: "John Doe"}, got.Metadata)
		assert.Equal(t, "journey_old", written.JourneyID)
		assert.Equal(t, metadata, written.EncryptedMetadata)
		assert.Equal(t, "editor", written.ProjectMember.Relation)

		require.Len(t, *events, 2)
		cancelled := invitationEvent[domain.InvitationCancelledPayload](t, (*events)[0], domain.EventTypeInvitationCancelled, "inv_old")
		assert.Equal(t, domain.InvitationCancelledPayload{
			JourneyID:              "journey_old",
			Reason:                 domain.InvitationCancelReasonReplaced,
			ReplacedByInvitationID: "inv_new",
		}, cancelled)
		created := invitationEvent[domain.InvitationCreatedPayload](t, (*events)[1], domain.EventTypeInvitationCreated, "inv_new")
		assert.Equal(t, "inv_old", created.ReplacesInvitationID)
		assert.Equal(t, "journey_old", created.JourneyID)
	})

	t.Run("keeps its own metadata and reads the original once", func(t *testing.T) {
		t.Parallel()
		svc, s, keys, _ := newMockedInvitationService(t, grantPlatformProjID)
		keys.EXPECT().GetProjectCrypter(gomock.Any(), invitationProjectID, domain.EncryptionKeyPurposeSecret).Return(testCrypter(invitationKeyID), nil)
		expectClaimedProject(s, invitationProjectID)
		s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
		s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_old").
			Return(original(domain.InvitationStatusPending, now.Add(time.Hour), encryptedInvitationMetadata(t, "John Doe")), nil)
		s.EXPECT().DeleteUnacceptedInvitation(gomock.Any(), invitationProjectID, "inv_old").Return(nil)
		s.EXPECT().CountPendingInvitations(gomock.Any(), invitationProjectID, gomock.Any()).Return(int64(0), nil)
		s.EXPECT().CreateInvitation(gomock.Any(), gomock.Any()).Return(nil)

		input := replaceInput()
		input.Metadata = &domain.InvitationMetadata{Name: "Jane Roe"}
		got, err := svc.Create(t.Context(), input)
		require.NoError(t, err)
		assert.Equal(t, &domain.InvitationMetadata{Name: "Jane Roe"}, got.Metadata)
	})

	deletions := []struct {
		name     string
		status   domain.InvitationStatus
		expires  time.Time
		metadata *string
	}{
		{"deletes an expired original", domain.InvitationStatusPending, now.Add(-time.Hour), encryptedInvitationMetadata(t, "John Doe")},
		{"deletes a rejected original, whose metadata is already gone", domain.InvitationStatusRejected, now.Add(time.Hour), nil},
	}
	for _, tc := range deletions {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, s, keys, _ := newMockedInvitationService(t, grantPlatformProjID)
			if tc.metadata != nil {
				keys.EXPECT().GetCrypter(gomock.Any(), invitationKeyID, jose.A256GCM).Return(testCrypter(invitationKeyID), nil)
			}
			expectClaimedProject(s, invitationProjectID)
			s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
			s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_old").
				Return(original(tc.status, tc.expires, tc.metadata), nil).Times(2)
			s.EXPECT().DeleteUnacceptedInvitation(gomock.Any(), invitationProjectID, "inv_old").Return(nil)
			s.EXPECT().CountPendingInvitations(gomock.Any(), invitationProjectID, gomock.Any()).Return(int64(0), nil)
			s.EXPECT().CreateInvitation(gomock.Any(), gomock.Any()).Return(nil)

			_, err := svc.Create(t.Context(), replaceInput())
			require.NoError(t, err)
		})
	}

	refusals := []struct {
		name    string
		setup   func(s *servicemocks.MockAllStatements)
		wantErr error
	}{
		{
			name: "accepted original",
			setup: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
				s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_old").
					Return(original(domain.InvitationStatusAccepted, now.Add(time.Hour), nil), nil).Times(2)
			},
			wantErr: domain.ErrInvitationNotPending(),
		},
		{
			name: "original accepted after the read",
			setup: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().LockProject(gomock.Any(), invitationProjectID).Return(nil)
				s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_old").
					Return(original(domain.InvitationStatusPending, now.Add(time.Hour), nil), nil).Times(2)
				s.EXPECT().DeleteUnacceptedInvitation(gomock.Any(), invitationProjectID, "inv_old").
					Return(database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInvitationNotPending(),
		},
		{
			name: "unknown original",
			setup: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_old").
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInvitationNotFound(),
		},
	}
	for _, tc := range refusals {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
			expectClaimedProject(s, invitationProjectID)
			tc.setup(s)
			got, err := svc.Create(t.Context(), replaceInput())
			require.ErrorIs(t, err, tc.wantErr)
			assert.Nil(t, got)
		})
	}
}

func TestInvitationService_Cancel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		setup   func(s *servicemocks.MockAllStatements)
		wantErr error
	}{
		{
			name: "deletes a pending invitation",
			setup: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_1").Return(&domain.Invitation{ProjectID: invitationProjectID, ID: "inv_1", JourneyID: "journey_1"}, nil)
				s.EXPECT().DeletePendingInvitation(gomock.Any(), invitationProjectID, "inv_1", gomock.Any()).Return(nil)
			},
		},
		{
			name: "unknown invitation",
			setup: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInvitationNotFound(),
		},
		{
			name: "finished or expired invitation",
			setup: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_1").Return(&domain.Invitation{ProjectID: invitationProjectID, ID: "inv_1", JourneyID: "journey_1"}, nil)
				s.EXPECT().DeletePendingInvitation(gomock.Any(), invitationProjectID, "inv_1", gomock.Any()).Return(database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrInvitationNotPending(),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, s, _, events := newMockedInvitationService(t, grantPlatformProjID)
			tc.setup(s)
			err := svc.Cancel(t.Context(), invitationProjectID, "inv_1")
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Empty(t, *events)
				return
			}
			require.NoError(t, err)
			require.Len(t, *events, 1)
			cancelled := invitationEvent[domain.InvitationCancelledPayload](t, (*events)[0], domain.EventTypeInvitationCancelled, "inv_1")
			assert.Equal(t, domain.InvitationCancelledPayload{
				JourneyID: "journey_1",
				Reason:    domain.InvitationCancelReasonCancelled,
			}, cancelled)
		})
	}
}

func TestInvitationService_Get(t *testing.T) {
	t.Parallel()

	t.Run("decrypts the metadata with the key that wrote it", func(t *testing.T) {
		t.Parallel()
		svc, s, keys, _ := newMockedInvitationService(t, grantPlatformProjID)
		s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_1").Return(&domain.Invitation{
			ID:                "inv_1",
			EncryptedMetadata: encryptedInvitationMetadata(t, "John Doe"),
		}, nil)
		keys.EXPECT().GetCrypter(gomock.Any(), invitationKeyID, jose.A256GCM).Return(testCrypter(invitationKeyID), nil)

		got, err := svc.Get(t.Context(), invitationProjectID, "inv_1")
		require.NoError(t, err)
		assert.Equal(t, &domain.InvitationMetadata{Name: "John Doe"}, got.Metadata)
	})

	t.Run("no metadata after accept or decline", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_1").Return(&domain.Invitation{ProjectID: invitationProjectID, ID: "inv_1", JourneyID: "journey_1"}, nil)

		got, err := svc.Get(t.Context(), invitationProjectID, "inv_1")
		require.NoError(t, err)
		assert.Nil(t, got.Metadata)
	})

	t.Run("unknown invitation", func(t *testing.T) {
		t.Parallel()
		svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
		s.EXPECT().GetInvitationByID(gomock.Any(), invitationProjectID, "inv_1").Return(nil, database.NewNoRowFoundError(nil))

		_, err := svc.Get(t.Context(), invitationProjectID, "inv_1")
		require.ErrorIs(t, err, domain.ErrInvitationNotFound())
	})
}

func TestInvitationService_List(t *testing.T) {
	t.Parallel()

	svc, s, _, _ := newMockedInvitationService(t, grantPlatformProjID)
	s.EXPECT().ListInvitations(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, opts *database.ListOptions[domain.InvitationField]) (*database.ListResult[*domain.Invitation], error) {
			assert.Equal(t, []byte("cursor_1"), opts.Pagination.Cursor)
			assert.Equal(t, uint32(5), opts.Pagination.Limit)
			return &database.ListResult[*domain.Invitation]{
				Items:      []*domain.Invitation{{ID: "inv_2"}, {ID: "inv_1"}},
				NextCursor: []byte("cursor_2"),
			}, nil
		})

	status := domain.InvitationStatusPending
	got, err := svc.List(t.Context(), service.ListInvitationsRequest{
		ProjectID: invitationProjectID,
		Status:    &status,
		Limit:     5,
		PageToken: "cursor_1",
	})
	require.NoError(t, err)
	require.Len(t, got.Invitations, 2)
	assert.Equal(t, "inv_2", got.Invitations[0].ID)
	assert.Equal(t, "cursor_2", got.NextPageToken)
}
