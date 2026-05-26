//go:build integration

package service_test

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func newSessionServiceForIntegration(t *testing.T) service.SessionService {
	t.Helper()
	pool := integrationPoolOrFail(t)
	sessRepo := repository.NewSessionRepository(pool)
	return service.NewSessionService(pool, sessRepo)
}

func TestSessionService_Exchange_integration(t *testing.T) {
	pool := integrationPoolOrFail(t)
	svc := newSessionServiceForIntegration(t)

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
		assert.WithinDuration(t, stored.UpdatedAt.Add(stored.TimeToLive), stored.ExpiresAt, 2*time.Second)
	})

	t.Run("step_up_existing_session", func(t *testing.T) {
		projectID := "p-svc-ex-step-" + time.Now().Format("150405.000000")
		ensureProject(t, pool, projectID)

		anonymous, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, repository.NewSessionRepository(pool).Create(t.Context(), pool, anonymous))

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
