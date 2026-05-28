package api

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
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
		ttl := 2 * time.Hour
		key := "idem-1"
		input := exchangeInputFromRequest(
			"proj-1",
			&api.ExchangeRequest{
				HandoffToken: "token-1",
				TTL:          api.NewOptDuration(ttl),
			},
			api.ExchangeHandoffParams{
				IdempotencyKey: api.NewOptString(key),
			},
		)
		require.Equal(t, "proj-1", input.ProjectID)
		require.Equal(t, "token-1", input.HandoffToken)
		require.NotNil(t, input.TTL)
		require.Equal(t, ttl, *input.TTL)
		require.NotNil(t, input.IdempotencyKey)
		require.Equal(t, key, *input.IdempotencyKey)
	})

	t.Run("omitted ttl remains nil", func(t *testing.T) {
		input := exchangeInputFromRequest(
			"proj-1",
			&api.ExchangeRequest{
				HandoffToken: "token-1",
			},
			api.ExchangeHandoffParams{},
		)
		require.Nil(t, input.TTL)
		require.Nil(t, input.IdempotencyKey)
	})

	t.Run("malformed duration is rejected by generated parser", func(t *testing.T) {
		var ttl api.OptDuration
		err := ttl.UnmarshalJSON([]byte(`"not-a-duration"`))
		require.Error(t, err)
	})
}
