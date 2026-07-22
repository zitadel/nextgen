package api

import (
	"errors"
	"testing"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

func TestHandleNextgenSession(t *testing.T) {
	t.Parallel()

	t.Run("valid token is stashed in context", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{
			ProjectID: "project-1",
			TokenID:   "token-1",
			Type:      domain.TokenTypeSessionToken,
			SessionID: new("session-1"),
		}

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().VerifyToken(gomock.Any(), gomock.Any()).Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		ctx, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.NoError(t, err)

		got, ok := sessionTokenFromContext(ctx)
		require.True(t, ok)
		require.Equal(t, token, got)
	})

	t.Run("invalid token is an unsatisfied requirement", func(t *testing.T) {
		t.Parallel()

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().VerifyToken(gomock.Any(), gomock.Any()).Return(nil, errors.New("bad token"))

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "garbage"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	t.Run("non-session token type is rejected", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{Type: domain.TokenTypeOIDCAccessToken}

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().VerifyToken(gomock.Any(), gomock.Any()).Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})
}
