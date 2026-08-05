package api

import (
	"encoding/json"
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
		TokenID:   "tkn_100",
		ExpiresAt: now.Add(time.Hour),
	}
	token := &domain.Token{
		TokenID:   "tkn_100",
		ExpiresAt: new(now.Add(time.Hour)),
	}

	require.NoError(t, validateSessionToken(session, token))

	token.TokenID = "tkn_99"
	require.ErrorIs(t, validateSessionToken(session, token), domain.ErrSessionTokenInvalid())

	token.TokenID = "tkn_100"
	session.ExpiresAt = now.Add(-time.Minute)
	require.ErrorIs(t, validateSessionToken(session, token), domain.ErrSessionTokenInvalid())

	// A revoked session invalidates its derived token even while unexpired.
	session.ExpiresAt = now.Add(time.Hour)
	revokedAt := now
	session.RevokedAt = &revokedAt
	require.ErrorIs(t, validateSessionToken(session, token), domain.ErrSessionTokenInvalid())
}

func TestInvalidSessionCredential(t *testing.T) {
	t.Parallel()

	err := invalidSessionCredential(domain.ErrSessionTokenInvalid())
	require.ErrorIs(t, err, domain.ErrAuthUnauthorized(nil))
	require.ErrorIs(t, err, domain.ErrSessionTokenInvalid())
	require.Equal(t, "auth.unauthorized", err.Code)
	require.Equal(t, sessionUnauthorizedMessage, err.Message)
}

func TestUserAgentToAPI(t *testing.T) {
	t.Parallel()

	opt := userAgentToAPI(&domain.UserAgent{
		ID: "fp_abc123",
		IP: "203.0.113.42",
		Info: map[string]any{
			"browser":     "test",
			"fingerprint": "shadow",
			"ip":          "shadow-ip",
		},
	})

	ua, ok := opt.Get()
	require.True(t, ok)
	require.Equal(t, "fp_abc123", ua.GetFingerprint().Value)
	require.Equal(t, "203.0.113.42", ua.GetIP().Value)
	require.Contains(t, ua.AdditionalProps, "browser")
	require.NotContains(t, ua.AdditionalProps, "fingerprint")
	require.NotContains(t, ua.AdditionalProps, "ip")

	data, err := json.Marshal(&ua)
	require.NoError(t, err)
	require.JSONEq(t, `{"fingerprint":"fp_abc123","ip":"203.0.113.42","browser":"test"}`, string(data))
}

func TestExchangeInputFromRequest(t *testing.T) {
	t.Parallel()

	t.Run("maps duration ttl", func(t *testing.T) {
		key := "idem-1"
		input, err := exchangeInputFromRequest(
			&api.ExchangeRequest{
				HandoffToken: "token-1",
				TTL:          api.NewOptDuration(ogenx.ISODuration(2 * time.Hour)),
			},
			api.ExchangeHandoffParams{
				ProjectID:      "proj-1",
				IdempotencyKey: api.NewOptString(key),
			},
		)
		require.NoError(t, err)
		require.EqualValues(t, "proj-1", input.ProjectID)
		require.Equal(t, "token-1", input.HandoffToken)
		require.NotNil(t, input.TTL)
		require.Equal(t, 2*time.Hour, *input.TTL)
		require.NotNil(t, input.IdempotencyKey)
		require.Equal(t, key, *input.IdempotencyKey)
	})

	t.Run("omitted ttl remains nil", func(t *testing.T) {
		input, err := exchangeInputFromRequest(
			&api.ExchangeRequest{
				HandoffToken: "token-1",
			},
			api.ExchangeHandoffParams{
				ProjectID: "proj-1",
			},
		)
		require.NoError(t, err)
		require.Nil(t, input.TTL)
		require.Nil(t, input.IdempotencyKey)
	})
}
