package service_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

// adminRecords serves ListProjectAdmins for a first page of the default size,
// one person more than it holds. Which people the query returns, and what it
// marks visible, is covered by the statement test; this pins what the service
// makes of them.
func adminRecords(viewerUserID string, records ...*domain.ProjectAdminRecord) func(*servicemocks.MockAllStatements) {
	return func(s *servicemocks.MockAllStatements) {
		s.EXPECT().ListProjectAdmins(gomock.Any(), "proj_customer", "", viewerUserID, uint32(21)).Return(records, nil)
	}
}

func adminRecord(userID string, sources ...domain.ProjectAdminSourceRecord) *domain.ProjectAdminRecord {
	return &domain.ProjectAdminRecord{UserID: userID, HomeProjectID: grantPlatformProjID, Sources: sources}
}

func listAdmins(t *testing.T, svc *service.GrantService, viewerUserID string) *service.ProjectAdmins {
	t.Helper()
	got, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer", ViewerUserID: viewerUserID})
	require.NoError(t, err)
	return got
}

func TestGrantService_ListProjectAdmins(t *testing.T) {
	t.Parallel()

	refs := func() *grantRefStub {
		return &grantRefStub{byID: map[string]domain.UserRef{
			"user_owner":  {UserID: "user_owner", Identifier: "owner@example.com", IdentifierProperty: "email"},
			"user_direct": {UserID: "user_direct", Identifier: "direct@example.com", IdentifierProperty: "email"},
			"user_ops":    {UserID: "user_ops", Identifier: "ops@example.com", IdentifierProperty: "email"},
		}}
	}
	// As the owner sees it: in the owning team, not in team_ops, whose name
	// the query therefore leaves out, as it leaves out people only in team_ops.
	opsGrant := domain.ProjectAdminSourceRecord{GrantID: "asgn_b", TeamID: "team_ops"}
	owningTeam := domain.ProjectAdminSourceRecord{OwningTeam: true, TeamID: "team_owner", TeamName: "Acme"}
	asOwner := adminRecords("user_owner",
		adminRecord("user_direct", opsGrant, domain.ProjectAdminSourceRecord{GrantID: "asgn_c"}),
		adminRecord("user_owner", owningTeam, domain.ProjectAdminSourceRecord{GrantID: "asgn_a"}),
	)

	t.Run("one entry per person with every source", func(t *testing.T) {
		t.Parallel()
		ref := refs()
		svc := newMockedGrantServiceWithRefs(t, grantPlatformProjID, ref, asOwner)

		got := listAdmins(t, svc, "user_owner")

		byUser := map[string]*service.ProjectAdmin{}
		var order []string
		for _, admin := range got.Admins {
			byUser[admin.User.UserID] = admin
			order = append(order, admin.User.UserID)
		}
		assert.Equal(t, []string{"user_direct", "user_owner"}, order, "in the order the query returns")
		assert.Empty(t, got.NextPageToken)

		assert.Equal(t, "owner@example.com", byUser["user_owner"].User.Identifier)
		assert.Equal(t, []service.ProjectAdminSource{
			{Type: service.ProjectAdminSourceOwningTeam, Team: &service.TeamRef{TeamID: "team_owner", Name: "Acme"}},
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_a"},
		}, byUser["user_owner"].Sources, "one entry, both sources")
		assert.Equal(t, []service.ProjectAdminSource{
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_b", Team: &service.TeamRef{TeamID: "team_ops"}},
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_c"},
		}, byUser["user_direct"].Sources)
		assert.Equal(t, "direct@example.com", byUser["user_direct"].User.Identifier)
		assert.ElementsMatch(t, []string{"user_direct", "user_owner"}, ref.gotUserIDs, "every person listed is looked up")
	})

	t.Run("no admins", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, adminRecords(""))

		got := listAdmins(t, svc, "")
		assert.Empty(t, got.Admins)
		assert.Empty(t, got.NextPageToken)
	})

	t.Run("a full page links to the next", func(t *testing.T) {
		t.Parallel()
		page := make([]*domain.ProjectAdminRecord, 0, 21)
		for i := range 21 {
			page = append(page, adminRecord(fmt.Sprintf("user_%05d", i), domain.ProjectAdminSourceRecord{GrantID: fmt.Sprintf("asgn_%05d", i)}))
		}
		var after string
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			gomock.InOrder(
				s.EXPECT().ListProjectAdmins(gomock.Any(), "proj_customer", "", "", uint32(21)).Return(page, nil),
				s.EXPECT().ListProjectAdmins(gomock.Any(), "proj_customer", gomock.Any(), "", uint32(21)).DoAndReturn(
					func(_ context.Context, _, afterUserID, _ string, _ uint32) ([]*domain.ProjectAdminRecord, error) {
						after = afterUserID
						return page[20:], nil
					}),
			)
		})

		first := listAdmins(t, svc, "")
		require.Len(t, first.Admins, 20, "the default page size")
		require.NotEmpty(t, first.NextPageToken, "a 21st person means another page")

		second, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer", PageToken: first.NextPageToken})
		require.NoError(t, err)
		assert.Equal(t, "user_00019", after, "the next page starts after the last person listed")
		require.Len(t, second.Admins, 1)
		assert.Equal(t, "user_00020", second.Admins[0].User.UserID)
		assert.Empty(t, second.NextPageToken)
	})

	t.Run("an invalid page token is refused", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(*servicemocks.MockAllStatements) {})

		_, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer", PageToken: "not a token"})
		assert.ErrorIs(t, err, domain.ErrRequestInvalid())
	})

	t.Run("a failed read is internal", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListProjectAdmins(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errors.New("boom"))
		})

		_, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer"})
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})
}
