package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

func TestHandleOAuth2(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		token *domain.Token
	}{
		{
			name: "project token mints sk_proj scope",
			token: &domain.Token{
				ProjectID: "project-1",
				TokenID:   "token-1",
				Type:      domain.TokenTypeProjectToken,
				Scope:     []string{"project.write", "project.read"},
			},
		},
		{
			name: "preview token mints sk_proj scope",
			token: &domain.Token{
				ProjectID: "project-1",
				TokenID:   "token-preview",
				Type:      domain.TokenTypeProjectPreview,
				Scope:     []string{"project.read"},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			mock := gomock.NewController(t)
			tokenService := mocks.NewMockTokenService(mock)
			tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-bearer").Return(tc.token, nil)

			handler := NewSecurityHandler(tokenService)
			ctx, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: "raw-bearer"})
			require.NoError(t, err)

			got, ok := GetScopeContext(ctx)
			require.True(t, ok)
			require.Equal(t, tc.token.ProjectID, got.ProjectID)
			require.Equal(t, domain.AuthzPrincipalTypeSKProj, got.PrincipalType)
			require.Equal(t, tc.token.ProjectID, got.PrincipalID)
			require.Equal(t, tc.token.Scope, got.Scope)
			sum := sha256.Sum256([]byte("raw-bearer"))
			require.Equal(t, hex.EncodeToString(sum[:]), got.SecretHash)
		})
	}

	t.Run("empty token is an unsatisfied requirement", func(t *testing.T) {
		t.Parallel()

		handler := NewSecurityHandler(nil)
		_, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: ""})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	t.Run("introspect error is an unsatisfied requirement", func(t *testing.T) {
		t.Parallel()

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, errors.New("bad token"))

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: "garbage"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	for _, tc := range []struct {
		name      string
		tokenType domain.TokenType
	}{
		{name: "unspecified token", tokenType: domain.TokenTypeUnspecified},
		{name: "session token", tokenType: domain.TokenTypeSessionToken},
		{name: "oidc access token", tokenType: domain.TokenTypeOIDCAccessToken},
		{name: "personal access token", tokenType: domain.TokenTypePersonalAccessToken},
	} {
		t.Run(tc.name+" is rejected", func(t *testing.T) {
			t.Parallel()

			token := &domain.Token{Type: tc.tokenType, ProjectID: "project-1"}
			mock := gomock.NewController(t)
			tokenService := mocks.NewMockTokenService(mock)
			tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-bearer").Return(token, nil)

			handler := NewSecurityHandler(tokenService)
			_, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: "raw-bearer"})
			require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
		})
	}
}

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
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-cookie").Return(token, nil)

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
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, errors.New("bad token"))

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "garbage"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	t.Run("non-session token type is rejected", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{Type: domain.TokenTypeOIDCAccessToken}

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-cookie").Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})
}
