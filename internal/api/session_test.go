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
		key := "idem-1"
		input, err := exchangeInputFromRequest(
			"proj-1",
			&api.ExchangeRequest{
				HandoffToken: "token-1",
				TTL:          api.NewOptString("PT2H"),
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

	t.Run("malformed iso duration is rejected", func(t *testing.T) {
		_, err := exchangeInputFromRequest(
			"proj-1",
			&api.ExchangeRequest{
				HandoffToken: "token-1",
				TTL:          api.NewOptString("not-a-duration"),
			},
			api.ExchangeHandoffParams{},
		)
		require.Error(t, err)
	})
}

func TestParseISO8601Duration(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name    string
		raw     string
		want    time.Duration
		wantErr bool
	}{
		{name: "hours", raw: "PT3H", want: 3 * time.Hour},
		{name: "minutes", raw: "PT45M", want: 45 * time.Minute},
		{name: "composite", raw: "P1DT2H3M4S", want: 24*time.Hour + 2*time.Hour + 3*time.Minute + 4*time.Second},
		{name: "invalid", raw: "3h", wantErr: true},
		{name: "empty payload", raw: "P", wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseISO8601Duration(tc.raw)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}
}
