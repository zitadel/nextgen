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

// id ends every sort, so registrations sharing a created_at or an expires_at
// still page in one order and a cursor neither skips nor repeats them.
func TestClientRegistrationService_List_EndsTheSortWithID(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name      string
		sorting   *service.Sorting
		direction database.OrderDirection
		first     domain.ClientRegistrationField
	}{
		{"defaults to created_at ascending", nil, database.OrderAsc, domain.ClientRegistrationFieldCreatedAt},
		{"a requested sort keeps id after it", &service.Sorting{Field: "expires_at", Direction: "desc"}, database.OrderDesc, domain.ClientRegistrationFieldExpiresAt},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctrl := gomock.NewController(t)
			pool := servicemocks.NewMockPool(ctrl)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			pool.EXPECT().Statements().Return(stmts).AnyTimes()
			var got *database.ListOptions[domain.ClientRegistrationField]
			stmts.EXPECT().
				ListClientRegistrations(gomock.Any(), gomock.Any()).
				DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.ClientRegistrationField]) (*database.ListResult[*domain.ClientRegistration], error) {
					got = opts
					return &database.ListResult[*domain.ClientRegistration]{}, nil
				})

			svc := service.NewClientRegistrationService(service.NewPool(pool), service.NoConsents{})
			_, err := svc.List(t.Context(), service.ListClientRegistrationsInput{ProjectID: "proj_1", Sorting: tc.sorting})
			require.NoError(t, err)

			assert.Equal(t, database.OrderBy[domain.ClientRegistrationField]{
				Columns: []database.Column[domain.ClientRegistrationField]{
					database.Col(tc.first),
					database.Col(domain.ClientRegistrationFieldID),
				},
				Direction: tc.direction,
			}, got.Pagination.OrderBy)
		})
	}
}
