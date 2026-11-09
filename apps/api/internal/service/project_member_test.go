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
var firstPage = database.Page[domain.ProjectMemberField]{
	Limit: 20,
	OrderBy: database.OrderBy[domain.ProjectMemberField]{
		Columns:   []database.Column[domain.ProjectMemberField]{database.Col(domain.ProjectMemberFieldUserID)},
		Direction: database.OrderAsc,
	},
}

// memberRecords serves ListProjectMembers for the first page. Which people the
// query returns, and how it pages, is covered by the statement test; this pins
// what the service makes of them.
func memberRecords(records ...*domain.ProjectMemberRecord) func(*servicemocks.MockAllStatements) {
	return func(s *servicemocks.MockAllStatements) {
		s.EXPECT().ListProjectMembers(gomock.Any(), "proj_customer", "", firstPage).
			Return(&database.ListResult[*domain.ProjectMemberRecord]{Items: records}, nil)
	}
}

func memberRecord(userID, relation string, sources ...domain.ProjectMemberSourceRecord) *domain.ProjectMemberRecord {
	return &domain.ProjectMemberRecord{UserID: userID, HomeProjectID: grantPlatformProjID, Relation: relation, Sources: sources}
}

func listMembers(t *testing.T, svc *service.GrantService) *service.ProjectMembers {
	t.Helper()
	got, err := svc.ListProjectMembers(t.Context(), service.ListProjectMembersInput{ProjectID: "proj_customer"})
	require.NoError(t, err)
	return got
}

func TestGrantService_ListProjectMembers(t *testing.T) {
	t.Parallel()

	refs := func() *grantRefStub {
		return &grantRefStub{byID: map[string]domain.UserRef{
			"user_owner":  {UserID: "user_owner", Identifier: "owner@example.com", IdentifierProperty: "email"},
			"user_direct": {UserID: "user_direct", Identifier: "direct@example.com", IdentifierProperty: "email"},
			"user_ops":    {UserID: "user_ops", Identifier: "ops@example.com", IdentifierProperty: "email"},
		}}
	}
	opsGrant := domain.ProjectMemberSourceRecord{GrantID: "asgn_b", TeamID: "team_ops", TeamName: "Ops"}
	owningTeam := domain.ProjectMemberSourceRecord{OwningTeam: true, TeamID: "team_owner", TeamName: "Acme"}
	records := memberRecords(
		memberRecord("user_direct", "editor", opsGrant, domain.ProjectMemberSourceRecord{GrantID: "asgn_c"}),
		memberRecord("user_owner", "admin", owningTeam, domain.ProjectMemberSourceRecord{GrantID: "asgn_a"}),
	)

	t.Run("one entry per person with their role and its sources", func(t *testing.T) {
		t.Parallel()
		ref := refs()
		svc := newMockedGrantServiceWithRefs(t, grantPlatformProjID, ref, records)

		got := listMembers(t, svc)

		byUser := map[string]*service.ProjectMember{}
		var order []string
		for _, member := range got.Members {
			byUser[member.User.UserID] = member
			order = append(order, member.User.UserID)
		}
		assert.Equal(t, []string{"user_direct", "user_owner"}, order, "in the order the query returns")
		assert.Empty(t, got.NextPageToken)

		assert.Equal(t, "owner@example.com", byUser["user_owner"].User.Identifier)
		assert.Equal(t, "admin", byUser["user_owner"].Relation)
		assert.Equal(t, []domain.ProjectMemberSourceRecord{owningTeam, {GrantID: "asgn_a"}}, byUser["user_owner"].Sources, "one entry, both sources")
		assert.Equal(t, "editor", byUser["user_direct"].Relation)
		assert.Equal(t, []domain.ProjectMemberSourceRecord{opsGrant, {GrantID: "asgn_c"}}, byUser["user_direct"].Sources)
		assert.Equal(t, "direct@example.com", byUser["user_direct"].User.Identifier)
		assert.ElementsMatch(t, []string{"user_direct", "user_owner"}, ref.gotUserIDs, "every person listed is looked up")
	})

	t.Run("no members", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, memberRecords())

		got := listMembers(t, svc)
		assert.Empty(t, got.Members)
		assert.Empty(t, got.NextPageToken)
	})

	t.Run("the relation filter passes through", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListProjectMembers(gomock.Any(), "proj_customer", "admin", firstPage).
				Return(&database.ListResult[*domain.ProjectMemberRecord]{}, nil)
		})

		_, err := svc.ListProjectMembers(t.Context(), service.ListProjectMembersInput{ProjectID: "proj_customer", MinRelation: "admin"})
		require.NoError(t, err)
	})

	t.Run("a relation that is not a project role is a bad request", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(*servicemocks.MockAllStatements) {})

		_, err := svc.ListProjectMembers(t.Context(), service.ListProjectMembersInput{ProjectID: "proj_customer", MinRelation: "team"})
		assert.ErrorIs(t, err, domain.ErrRequestInvalid())
	})

	t.Run("the page token passes through both ways", func(t *testing.T) {
		t.Parallel()
		next := firstPage
		next.Cursor = []byte("token-1")
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			gomock.InOrder(
				s.EXPECT().ListProjectMembers(gomock.Any(), "proj_customer", "", firstPage).Return(&database.ListResult[*domain.ProjectMemberRecord]{
					Items:      []*domain.ProjectMemberRecord{memberRecord("user_a", "viewer", domain.ProjectMemberSourceRecord{GrantID: "asgn_a"})},
					NextCursor: []byte("token-1"),
				}, nil),
				s.EXPECT().ListProjectMembers(gomock.Any(), "proj_customer", "", next).Return(&database.ListResult[*domain.ProjectMemberRecord]{
					Items: []*domain.ProjectMemberRecord{memberRecord("user_b", "viewer", domain.ProjectMemberSourceRecord{GrantID: "asgn_b"})},
				}, nil),
			)
		})

		first := listMembers(t, svc)
		assert.Equal(t, "token-1", first.NextPageToken)
		second, err := svc.ListProjectMembers(t.Context(), service.ListProjectMembersInput{ProjectID: "proj_customer", PageToken: first.NextPageToken})
		require.NoError(t, err)
		require.Len(t, second.Members, 1)
		assert.Equal(t, "user_b", second.Members[0].User.UserID)
		assert.Empty(t, second.NextPageToken)
	})

	t.Run("an invalid page token is a bad request", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListProjectMembers(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, database.ErrInvalidCursor())
		})

		_, err := svc.ListProjectMembers(t.Context(), service.ListProjectMembersInput{ProjectID: "proj_customer", PageToken: "not a token"})
		assert.ErrorIs(t, err, domain.ErrRequestInvalid())
	})

	t.Run("a failed read is internal", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, func(s *servicemocks.MockAllStatements) {
			s.EXPECT().ListProjectMembers(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errors.New("boom"))
		})

		_, err := svc.ListProjectMembers(t.Context(), service.ListProjectMembersInput{ProjectID: "proj_customer"})
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})
}
