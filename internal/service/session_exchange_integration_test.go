//go:build postgres_integration

package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	pgold "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

func integrationV2PoolOrFail(t *testing.T) service.StatementPool {
	t.Helper()
	pool := integrationPoolOrFail(t)
	var pgxPool *pgxpool.Pool
	switch p := pool.(type) {
	case *embedded.Pool:
		pgxPool = p.Pool.Pool
	case *pgold.Pool:
		pgxPool = p.Pool
	default:
		t.Fatalf("unsupported pool type %T", pool)
	}
	v2, err := (&v2postgres.PoolConfig{Pool: pgxPool}).Connect(t.Context())
	require.NoError(t, err)
	return service.NewPool(v2.(service.Pool))
}

func newSessionServiceForIntegration(t *testing.T) (service.SessionService, service.SessionConfig) {
	t.Helper()
	pool := integrationPoolOrFail(t)
	cfg := service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour}
	return service.NewSessionService(pool, integrationV2PoolOrFail(t), repository.NewUserRepository(), cfg), cfg
}

func TestSessionService_Exchange_integration(t *testing.T) {
	pool := integrationPoolOrFail(t)
	svc, cfg := newSessionServiceForIntegration(t)
	v2 := integrationV2PoolOrFail(t)

	t.Run("new_session_promotes_password", func(t *testing.T) {
		projectID := "p-svc-ex-new-" + time.Now().Format("150405.000000")
		plain, _ := handoffCompletedAttempt(t, pool, projectID, nil)

		exchanged, err := svc.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: plain,
		})
		require.NoError(t, err)
		require.NotEmpty(t, exchanged.ID)

		stored, err := svc.Get(t.Context(), service.GetSessionInput{
			ProjectID: projectID,
			SessionID: exchanged.ID,
		})
		require.NoError(t, err)
		factors := sessionFactorsByType(stored)
		require.Contains(t, factors, domain.AuthCheckTypePassword)
		assert.False(t, factors[domain.AuthCheckTypePassword].GetLastVerifiedAt().IsZero())
		assert.Equal(t, cfg.DefaultTTL, stored.TimeToLive)
		assert.WithinDuration(t, stored.UpdatedAt.Add(stored.TimeToLive), stored.ExpiresAt, 2*time.Second)
	})

	t.Run("explicit_ttl", func(t *testing.T) {
		projectID := "p-svc-ex-ttl-" + time.Now().Format("150405.000000")
		plain, _ := handoffCompletedAttempt(t, pool, projectID, nil)
		override := 2 * time.Hour

		exchanged, err := svc.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: plain,
			TTL:          &override,
		})
		require.NoError(t, err)

		stored, err := svc.Get(t.Context(), service.GetSessionInput{
			ProjectID: projectID,
			SessionID: exchanged.ID,
		})
		require.NoError(t, err)
		assert.Equal(t, override, stored.TimeToLive)
	})

	t.Run("step_up_existing_session", func(t *testing.T) {
		projectID := "p-svc-ex-step-" + time.Now().Format("150405.000000")
		ensureProject(t, pool, projectID)

		anonymous, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, v2.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return tx.Statements().CreateSession(ctx, anonymous)
		}))

		plain, _ := handoffCompletedAttempt(t, pool, projectID, func(a *domain.AuthAttempt) {
			a.SessionID = &anonymous.ID
		})

		exchanged, err := svc.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: plain,
		})
		require.NoError(t, err)
		assert.Equal(t, anonymous.ID, exchanged.ID)

		stored, err := svc.Get(t.Context(), service.GetSessionInput{
			ProjectID: projectID,
			SessionID: exchanged.ID,
		})
		require.NoError(t, err)
		_, hasPassword := sessionFactorsByType(stored)[domain.AuthCheckTypePassword]
		assert.True(t, hasPassword)
	})

	t.Run("invalid_handoff_token", func(t *testing.T) {
		projectID := "p-svc-ex-invalid-" + time.Now().Format("150405.000000")
		ensureProject(t, pool, projectID)

		_, err := svc.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: "not-a-real-token",
		})
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrSessionInvalidHandoffToken()))
		assert.False(t, errors.Is(err, domain.ErrInternal(nil)))
	})

	t.Run("consumed_token", func(t *testing.T) {
		projectID := "p-svc-ex-consume-" + time.Now().Format("150405.000000")
		plain, _ := handoffCompletedAttempt(t, pool, projectID, nil)

		_, err := svc.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: plain,
		})
		require.NoError(t, err)

		_, err = svc.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: plain,
		})
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrSessionInvalidHandoffToken()))
	})
}
