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

// adminRows serves ListProjectAdminSources for a first page of the default
// size, one person more than it holds. Which rows the query returns, and what
// it marks visible, is covered by the statement test; this pins what the
// service makes of them.
func adminRows(viewerUserID string, rows ...*domain.ProjectAdminSourceRow) func(*servicemocks.MockAllStatements) {
	return func(s *servicemocks.MockAllStatements) {
		s.EXPECT().ListProjectAdminSources(gomock.Any(), "proj_customer", "", viewerUserID, uint32(21)).Return(rows, nil)
	}
}

// teamRow is a source through a team, named only when the viewer may see it.
func teamRow(userID, grantID, teamID, teamName string, visible bool) *domain.ProjectAdminSourceRow {
	row := &domain.ProjectAdminSourceRow{UserID: userID, HomeProjectID: grantPlatformProjID, OwningTeam: grantID == "", GrantID: grantID, TeamID: teamID, Visible: visible}
	if visible {
		row.TeamName = teamName
	}
	return row
}

func userGrantRow(userID, grantID string) *domain.ProjectAdminSourceRow {
	return &domain.ProjectAdminSourceRow{UserID: userID, HomeProjectID: grantPlatformProjID, GrantID: grantID, Visible: true}
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
	byUser := func(admins []*service.ProjectAdmin) map[string]*service.ProjectAdmin {
		out := map[string]*service.ProjectAdmin{}
		for _, admin := range admins {
			out[admin.User.UserID] = admin
		}
		return out
	}

	t.Run("one entry per person with every source", func(t *testing.T) {
		t.Parallel()
		// As the owner sees it: in the owning team, not in team_ops.
		ref := refs()
		svc := newMockedGrantServiceWithRefs(t, grantPlatformProjID, ref, adminRows("user_owner",
			teamRow("user_direct", "asgn_b", "team_ops", "Ops", false), userGrantRow("user_direct", "asgn_c"),
			teamRow("user_ops", "asgn_b", "team_ops", "Ops", false),
			teamRow("user_owner", "", "team_owner", "Acme", true), userGrantRow("user_owner", "asgn_a"),
		))

		got := listAdmins(t, svc, "user_owner")

		var order []string
		for _, admin := range got.Admins {
			order = append(order, admin.User.UserID)
		}
		assert.Equal(t, []string{"user_direct", "user_ops", "user_owner"}, order, "ordered by user id")
		assert.Empty(t, got.NextPageToken)

		admins := byUser(got.Admins)
		assert.Equal(t, "owner@example.com", admins["user_owner"].User.Identifier)
		assert.Equal(t, []service.ProjectAdminSource{
			{Type: service.ProjectAdminSourceOwningTeam, Team: &service.TeamRef{TeamID: "team_owner", Name: "Acme"}},
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_a"},
		}, admins["user_owner"].Sources, "one row, both sources")
		assert.Equal(t, []service.ProjectAdminSource{
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_b", Team: &service.TeamRef{TeamID: "team_ops"}},
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_c"},
		}, admins["user_direct"].Sources)
		assert.Equal(t, "direct@example.com", admins["user_direct"].User.Identifier, "one visible source shows the person")
		assert.Equal(t, domain.UserRef{UserID: "user_ops"}, admins["user_ops"].User, "no visible source leaves the user id")
		assert.ElementsMatch(t, []string{"user_direct", "user_owner"}, ref.gotUserIDs, "only the people shown are looked up")
	})

	t.Run("no sources is no admins", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, adminRows(""))

		got := listAdmins(t, svc, "")
		assert.Empty(t, got.Admins)
		assert.Empty(t, got.NextPageToken)
	})

	t.Run("a full page links to the next", func(t *testing.T) {
		t.Parallel()
		page := make([]*domain.ProjectAdminSourceRow, 0, 21)
		for i := range 21 {
			page = append(page, userGrantRow(fmt.Sprintf("user_%05d", i), fmt.Sprintf("asgn_%05d", i)))
		}
		var after string
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			gomock.InOrder(
				s.EXPECT().ListProjectAdminSources(gomock.Any(), "proj_customer", "", "", uint32(21)).Return(page, nil),
				s.EXPECT().ListProjectAdminSources(gomock.Any(), "proj_customer", gomock.Any(), "", uint32(21)).DoAndReturn(
					func(_ context.Context, _, afterUserID, _ string, _ uint32) ([]*domain.ProjectAdminSourceRow, error) {
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
			s.EXPECT().ListProjectAdminSources(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errors.New("boom"))
		})

		_, err := svc.ListProjectAdmins(t.Context(), service.ListProjectAdminsInput{ProjectID: "proj_customer"})
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})
}
