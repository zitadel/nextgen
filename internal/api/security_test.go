package api

import (
	"testing"

	"github.com/go-faster/errors"
	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

type stubTokenVerifier struct {
	token *domain.Token
	err   error
}

func (s stubTokenVerifier) Verify(string) (*domain.Token, error) {
	return s.token, s.err
}

func TestHandleNextgenSession(t *testing.T) {
	t.Parallel()

	sessionID := "session-1"
	valid := &domain.Token{
		ProjectID: "project-1",
		TokenID:   "token-1",
		Type:      domain.TokenTypeSessionToken,
		SessionID: &sessionID,
	}

	t.Run("valid token is stashed in context", func(t *testing.T) {
		t.Parallel()

		handler := NewSecurityHandler(stubTokenVerifier{token: valid})
		ctx, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.NoError(t, err)

		token, ok := sessionTokenFromContext(ctx)
		require.True(t, ok)
		require.Equal(t, valid, token)
	})

	t.Run("invalid token is an unsatisfied requirement", func(t *testing.T) {
		t.Parallel()

		handler := NewSecurityHandler(stubTokenVerifier{err: errors.New("bad token")})
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "garbage"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	t.Run("non-session token type is rejected", func(t *testing.T) {
		t.Parallel()

		handler := NewSecurityHandler(stubTokenVerifier{token: &domain.Token{Type: domain.TokenTypeOIDCAccessToken}})
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})
}
