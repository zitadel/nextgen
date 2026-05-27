package api

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestValidateSessionToken(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	session := &domain.Session{
		TokenID:   "100",
		ExpiresAt: now.Add(time.Hour),
	}
	token := &domain.SessionToken{
		TokenID:   "100",
		ExpiresAt: now.Add(time.Hour),
	}

	require.NoError(t, validateSessionToken(session, token))

	token.TokenID = "99"
	require.ErrorIs(t, validateSessionToken(session, token), domain.ErrSessionTokenInvalid())

	token.TokenID = "100"
	session.ExpiresAt = now.Add(-time.Minute)
	require.ErrorIs(t, validateSessionToken(session, token), domain.ErrSessionTokenInvalid())
}
