package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedUserService(t *testing.T, setupStmt func(*servicemocks.MockAllStatements)) (service.UserService, service.StatementPool) {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	if setupStmt != nil {
		setupStmt(statements)
	}
	return service.NewUserService(pool, nil, nil), pool
}

func TestUserService_GetUserByID(t *testing.T) {
	t.Parallel()

	userWithStatus := func(status domain.UserStatus) *domain.User {
		return &domain.User{
			ProjectID: "proj_1",
			ID:        "user_1",
			Metadata:  domain.UserMetadata{Status: status},
		}
	}

	tests := []struct {
		name      string
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.User)
	}{
		{
			name: "returns an active user",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(userWithStatus(domain.UserStatusActive), nil)
			},
			check: func(t *testing.T, got *domain.User) {
				assert.Equal(t, "user_1", got.ID)
			},
		},
		{
			name: "deactivated user stays visible",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(userWithStatus(domain.UserStatusDeactivated), nil)
			},
			check: func(t *testing.T, got *domain.User) {
				assert.Equal(t, domain.UserStatusDeactivated, got.Metadata.Status)
			},
		},
		{
			name: "pending_purge user reads as not found",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(userWithStatus(domain.UserStatusPendingPurge), nil)
			},
			wantErr: domain.ErrUserNotFound(),
		},
		{
			name: "missing user reads as not found",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrUserNotFound(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, _ := newMockedUserService(t, tc.setupStmt)

			got, err := svc.GetUserByID(t.Context(), service.GetUserInput{ProjectID: "proj_1", UserID: "user_1"})
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tc.check(t, got)
		})
	}
}

func TestUserService_ListUsers(t *testing.T) {
	t.Parallel()

	svc, _ := newMockedUserService(t, func(s *servicemocks.MockAllStatements) {
		s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				// List hides pending_purge users; every query carries this guard.
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.UserFieldProjectID), "proj_1"),
					database.Or(
						database.Equal(database.Col(domain.UserFieldStatus), "active"),
						database.Equal(database.Col(domain.UserFieldStatus), "suspended"),
						database.Equal(database.Col(domain.UserFieldStatus), "deactivated"),
					),
				), opts.Filter)
				return &database.ListResult[*domain.User]{
					Items:      []*domain.User{{ID: "user_1"}},
					NextCursor: []byte("next"),
				}, nil
			})
	})

	got, err := svc.ListUsers(t.Context(), service.ListUsersInput{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Len(t, got.Items, 1)
	assert.Equal(t, "next", got.NextPageToken)
}

func TestUserStatementsLookup_GetByAttributes(t *testing.T) {
	t.Parallel()

	attrs := []domain.Attribute{{Key: "email", Value: "user@example.com"}}
	_, pool := newMockedUserService(t, func(s *servicemocks.MockAllStatements) {
		s.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, filter database.Filter[domain.UserField], opts service.UserQueryOptions) (*domain.User, error) {
				// Login resolution must require the active status (#553).
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.UserFieldProjectID), "proj_1"),
					database.Equal(database.Col(domain.UserFieldStatus), domain.UserStatusActive.String()),
				), filter)
				assert.Equal(t, attrs, opts.Attributes)
				return nil, database.NewNoRowFoundError(nil)
			})
	})

	lookup := service.UserStatementsLookup{Pool: pool}
	_, err := lookup.GetByAttributes(t.Context(), "proj_1", attrs)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
