package api

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/ogenx"
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

func TestExchangeInputFromRequest(t *testing.T) {
	t.Parallel()

	t.Run("maps duration ttl", func(t *testing.T) {
		key := "idem-1"
		input, err := exchangeInputFromRequest(
			"proj-1",
			&api.ExchangeRequest{
				HandoffToken: "token-1",
				TTL:          api.NewOptDuration(ogenx.ISODuration(2 * time.Hour)),
			},
			api.ExchangeHandoffParams{
				IdempotencyKey: api.NewOptString(key),
			},
		)
		require.NoError(t, err)
		require.Equal(t, "proj-1", input.ProjectID)
		require.Equal(t, "token-1", input.HandoffToken)
		require.NotNil(t, input.TTL)
		require.Equal(t, 2*time.Hour, *input.TTL)
		require.NotNil(t, input.IdempotencyKey)
		require.Equal(t, key, *input.IdempotencyKey)
	})

	t.Run("omitted ttl remains nil", func(t *testing.T) {
		input, err := exchangeInputFromRequest(
			"proj-1",
			&api.ExchangeRequest{
				HandoffToken: "token-1",
			},
			api.ExchangeHandoffParams{},
		)
		require.NoError(t, err)
		require.Nil(t, input.TTL)
		require.Nil(t, input.IdempotencyKey)
	})
}
