package service_test

import (
	"context"
	"crypto/rand"
	"errors"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/op"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedTokenService(t *testing.T) (service.TokenService, *servicemocks.MockAllStatements, *servicemocks.MockKeyService) {
	t.Helper()
	ctrl := gomock.NewController(t)

	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	keys := servicemocks.NewMockKeyService(ctrl)

	return service.NewTokenService(keys, service.NewPool(pool)), statements, keys
}

// A token record the store could not read keeps the class of the storage
// failure as its outermost code, the one the response status is read from: an
// unavailable store answers 503, so clients retry instead of seeing an
// internal error. Only an unclassified failure is internal.
func TestTokenServiceIntrospectTokenStoreFailure(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name     string
		storeErr error
		wantCode string
	}{
		{"unavailable", database.NewUnavailableError(errors.New("retry budget spent")), domain.ErrUnavailable().Code},
		{"unclassified", errors.New("connection refused"), domain.ErrInternal(nil).Code},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, statements, keys := newMockedTokenService(t)

			var raw [32]byte
			_, err := rand.Read(raw[:])
			require.NoError(t, err)
			crypter := op.NewAES256GCMCrypto(raw, "enc_key_token")
			jwe, err := (&domain.Token{ProjectID: "proj_1", TokenID: "tkn_1", Type: domain.TokenTypeSessionToken}).JWE(crypter)
			require.NoError(t, err)

			keys.EXPECT().GetCrypter(gomock.Any(), "enc_key_token", jose.A256GCM).Return(crypter, nil)
			statements.EXPECT().GetTokenByID(gomock.Any(), "proj_1", "tkn_1").Return(nil, tc.storeErr)

			_, err = svc.IntrospectToken(t.Context(), jwe)
			outer, ok := errors.AsType[domain.Error](err)
			require.True(t, ok, "want a domain error, got %v", err)
			assert.Equal(t, tc.wantCode, outer.Code)
			assert.ErrorIs(t, err, tc.storeErr)
		})
	}
}

// The console runtime document resolves the publishable key on every request,
// so it reuses the project's preview record instead of minting one per call.
// That reuse rests on this lookup finding the record.
func TestTokenServiceGetActivePreviewToken(t *testing.T) {
	t.Parallel()
	svc, statements, _ := newMockedTokenService(t)

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
