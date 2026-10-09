package service_test

import (
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

// firstPage is the page the service asks for when the caller names none: the
// default size, ordered by user id.
var firstPage = database.Page[domain.ProjectAdminField]{
	Limit: 20,
	OrderBy: database.OrderBy[domain.ProjectAdminField]{
		Columns:   []database.Column[domain.ProjectAdminField]{database.Col(domain.ProjectAdminFieldUserID)},
		Direction: database.OrderAsc,
	},
}

// adminRecords serves ListProjectAdmins for the first page. Which people the
// query returns, what it marks visible, and how it pages, is covered by the
// statement test; this pins what the service makes of them.
func adminRecords(viewerUserID string, records ...*domain.ProjectAdminRecord) func(*servicemocks.MockAllStatements) {
	return func(s *servicemocks.MockAllStatements) {
		s.EXPECT().ListProjectAdmins(gomock.Any(), "proj_customer", viewerUserID, firstPage).
			Return(&database.ListResult[*domain.ProjectAdminRecord]{Items: records}, nil)
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

	t.Run("the page token passes through both ways", func(t *testing.T) {
		t.Parallel()
		next := firstPage
		next.Cursor = []byte("token-1")
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			gomock.InOrder(
				s.EXPECT().ListProjectAdmins(gomock.Any(), "proj_customer", "", firstPage).Return(&database.ListResult[*domain.ProjectAdminRecord]{
					Items:      []*domain.ProjectAdminRecord{adminRecord("user_a", domain.ProjectAdminSourceRecord{GrantID: "asgn_a"})},
					NextCursor: []byte("token-1"),
				}, nil),
				s.EXPECT().ListProjectAdmins(gomock.Any(), "proj_customer", "", next).Return(&database.ListResult[*domain.ProjectAdminRecord]{
					Items: []*domain.ProjectAdminRecord{adminRecord("user_b", domain.ProjectAdminSourceRecord{GrantID: "asgn_b"})},
				}, nil),
			)
		})

		first := listAdmins(t, svc, "")
		assert.Equal(t, "token-1", first.NextPageToken)
		second, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer", PageToken: first.NextPageToken})
		require.NoError(t, err)
		require.Len(t, second.Admins, 1)
		assert.Equal(t, "user_b", second.Admins[0].User.UserID)
		assert.Empty(t, second.NextPageToken)
	})

	t.Run("an invalid page token is a bad request", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListProjectAdmins(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.ErrInvalidCursor())
		})

		_, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer", PageToken: "not a token"})
		assert.ErrorIs(t, err, domain.ErrRequestInvalid())
	})

	t.Run("a failed read is internal", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListProjectAdmins(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errors.New("boom"))
		})

		_, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer"})
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})
}
