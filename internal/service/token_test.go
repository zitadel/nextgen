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

func newMockedTokenService(t *testing.T) (service.TokenService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)

	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()

	return service.NewTokenService(servicemocks.NewMockKeyService(ctrl), service.NewPool(pool)), statements
}

// The console runtime document resolves the publishable key on every request,
// so it reuses the project's preview record instead of minting one per call.
// That reuse rests on this lookup finding the record.
func TestTokenServiceGetActivePreviewToken(t *testing.T) {
	t.Parallel()
	svc, statements := newMockedTokenService(t)

	t.Run("happy", func(t *testing.T) {
		t.Run("existing token should be returned", func(t *testing.T) {
			stored := &domain.Token{
				ProjectID: "proj_1",
				TokenID:   "tkn_preview",
				Type:      domain.TokenTypeProjectPreview,
				Scope:     []string{"project.read"},
			}
			statements.EXPECT().
				ListTokens(gomock.Any(), gomock.Any()).
				DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.TokenField]) (*database.ListResult[*domain.Token], error) {
					assert.NotZero(t, opts.Pagination.Limit, "the lookup must read a bounded page")
					// Oldest first, so the project keeps answering with the same key.
					assert.Equal(t, []database.Column[domain.TokenField]{
						database.Col(domain.TokenFieldCreatedAt),
						database.Col(domain.TokenFieldTokenID),
					}, opts.Pagination.OrderBy.Columns)
					return &database.ListResult[*domain.Token]{Items: []*domain.Token{stored}}, nil
				})

			got, err := svc.GetActivePreviewToken(t.Context(), "proj_1")
			require.NoError(t, err)
			assert.Equal(t, stored, got)
		})

		t.Run("inactive tokens should be skipped", func(t *testing.T) {
			t.Parallel()
			expired := time.Now().Add(-time.Hour)
			statements.EXPECT().
				ListTokens(gomock.Any(), gomock.Any()).
				Return(&database.ListResult[*domain.Token]{Items: []*domain.Token{
					{ProjectID: "proj_1", TokenID: "tkn_expired", Type: domain.TokenTypeProjectPreview, ExpiresAt: &expired},
					{ProjectID: "proj_1", TokenID: "tkn_active", Type: domain.TokenTypeProjectPreview},
				}}, nil)

			got, err := svc.GetActivePreviewToken(t.Context(), "proj_1")
			require.NoError(t, err)
			assert.Equal(t, "tkn_active", got.TokenID)
		})
	})

	t.Run("not found should be propagates using a domain error", func(t *testing.T) {
		t.Parallel()
		statements.EXPECT().
			ListTokens(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Token]{}, nil)

		_, err := svc.GetActivePreviewToken(t.Context(), "proj_1")
		assert.ErrorIs(t, err, domain.TokenNotFound())
	})
}
