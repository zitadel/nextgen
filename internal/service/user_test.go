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

func TestUserService_ListUsers_ValidationErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   service.ListUsersInput
		wantErr error
	}{
		{
			name: "unknown filter field is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "owner", Operation: "equals", Value: "x"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort field is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "owner", Direction: "asc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort direction is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "sideways"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string id value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "id", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "ordering operation on schema is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "schema", Operation: "greater_than", Value: "sch_1"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_equals on id not implemented",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "id", Operation: "not_equals", Value: "usr_1"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "unknown status value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "equals", Value: "retired"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "contains on status is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "contains", Value: "act"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_equals on status not implemented",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "not_equals", Value: "active"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			// The column is null for self-owned users and `= NULL` matches
			// nothing, so a null value must be refused rather than silently
			// returning an empty page.
			name: "null lifecycle owner value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "lifecycle_owner_team_id", Operation: "equals", Value: nil}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "team_id cannot be sorted by",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "team_id", Direction: "asc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			// The storage option holds one team and filters are ANDed, so a
			// second value would silently win over the first.
			name: "team_id given twice is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters: []service.Filter{
					{Field: "team_id", Operation: "equals", Value: "team_1"},
					{Field: "team_id", Operation: "equals", Value: "team_2"},
				},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "contains on team_id is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "team_id", Operation: "contains", Value: "team_"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string team_id value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "team_id", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unparseable created_at value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: "not-a-time"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string created_at value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			// Validation fails before storage is reached, so no ListUsers
			// expectation is set and gomock would flag an unexpected call.
			svc, _ := newMockedUserService(t)

			out, err := svc.ListUsers(t.Context(), tc.input)
			require.ErrorIs(t, err, tc.wantErr)
			assert.Nil(t, out)
		})
	}
}

func TestUserService_ListUsers_TranslatesQuery(t *testing.T) {
	t.Parallel()

	t.Run("defaults to created_at desc with id as tiebreaker", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var got *database.ListOptions[domain.UserField]
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				got = opts
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{ProjectID: "proj_1"})
		require.NoError(t, err)

		require.Equal(t, database.OrderDesc, got.Pagination.OrderBy.Direction)
		require.Len(t, got.Pagination.OrderBy.Columns, 2)
		assert.Equal(t, domain.UserFieldCreatedAt, got.Pagination.OrderBy.Columns[0].Field())
		assert.Equal(t, domain.UserFieldID, got.Pagination.OrderBy.Columns[1].Field())
	})

	t.Run("sorting overrides the default and keeps the id tiebreaker", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var got *database.ListOptions[domain.UserField]
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				got = opts
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			Sorting:   &service.Sorting{Field: "status", Direction: "asc"},
		})
		require.NoError(t, err)

		require.Equal(t, database.OrderAsc, got.Pagination.OrderBy.Direction)
		require.Len(t, got.Pagination.OrderBy.Columns, 2)
		assert.Equal(t, domain.UserFieldStatus, got.Pagination.OrderBy.Columns[0].Field())
		assert.Equal(t, domain.UserFieldID, got.Pagination.OrderBy.Columns[1].Field())
	})

	t.Run("every filter field maps and reaches storage", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.User]{}, nil)

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			Filters: []service.Filter{
				{Field: "created_at", Operation: "greater_than", Value: time.Now().UTC().Format(time.RFC3339)},
				{Field: "id", Operation: "equals", Value: "usr_1"},
				{Field: "schema", Operation: "contains", Value: "sch_"},
				{Field: "status", Operation: "equals", Value: "active"},
				{Field: "team_id", Operation: "equals", Value: "team_1"},
				{Field: "lifecycle_owner_team_id", Operation: "equals", Value: "team_2"},
			},
		})
		require.NoError(t, err)
	})

	// Membership is not a column on the user, so it must not become a
	// database.Filter — it reaches storage as the EXISTS option instead.
	t.Run("team_id reaches storage as a query option, not a filter", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var gotOpts service.UserQueryOptions
		var gotList *database.ListOptions[domain.UserField]
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], q service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				gotList = opts
				gotOpts = q
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			Filters:   []service.Filter{{Field: "team_id", Operation: "equals", Value: "team_1"}},
		})
		require.NoError(t, err)

		require.NotNil(t, gotOpts.MembershipTeamID)
		assert.Equal(t, "team_1", *gotOpts.MembershipTeamID)
		// Only the implicit project predicate is left on the row filter.
		assert.NotNil(t, gotList.Filter)
	})

	t.Run("no membership filter leaves the query option unset", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var gotOpts service.UserQueryOptions
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ *database.ListOptions[domain.UserField], q service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				gotOpts = q
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{ProjectID: "proj_1"})
		require.NoError(t, err)

		assert.Nil(t, gotOpts.MembershipTeamID)
	})
}

func newMockedUserService(t *testing.T) (service.UserService, *servicemocks.MockAllStatements) {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	return service.NewUserService(service.NewPool(pool), nil, nil), stmts
}
