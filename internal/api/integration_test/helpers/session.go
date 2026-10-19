package helpers

import (
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureSessionService(t testing.TB) service.SessionService {
	t.Helper()
	h.sessionService.mutex.Lock()
	defer h.sessionService.mutex.Unlock()

	if h.sessionService.value == nil {
		h.sessionService.value = service.NewSessionService(
			h.EnsureServiceDB(t),
			service.StatementsUserRefResolver{Pool: h.EnsureServiceDB(t)},
			service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour},
		)
	}
	return h.sessionService.value
}

// CreateSession seeds a session directly in storage. No user is bound, so it
// reads as building until the TTL elapses. The database clock stamps
// expires_at while the state filter compares it against the service clock,
// so a test that needs the session expired must wait until that is
// observable rather than assume a tiny TTL has already elapsed.
func (h *Harness) CreateSession(t testing.TB, projectID string, ttl time.Duration) *domain.Session {
	t.Helper()
	session := &domain.Session{ProjectID: projectID, TimeToLive: ttl}
	require.NoError(t, h.EnsureServiceDB(t).Statements().CreateSession(t.Context(), session))
	return session
}

// CreateActiveSession exchanges a handed-off attempt with a verified user
// factor, binding the user to the new session. The user must exist:
// sessions.user_id references users.
//
// A handoff is valid for one minute, and the Spanner emulator can queue the
// exchange past it. Only on that answer the helper seeds a fresh attempt, up
// to three times; a handoff that is actually broken still fails the test.
// TestClaimHappyPath and the session exchange tests exchange exactly once.
func (h *Harness) CreateActiveSession(t testing.TB, projectID, userID string) *domain.Session {
	t.Helper()
	stmts := h.EnsureServiceDB(t).Statements()

	var err error
	for range 3 {
		attempt := &domain.AuthAttempt{
			ProjectID:      projectID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
			Checks:         []domain.AuthCheck{&domain.AuthFactorUser{UserID: userID}},
		}
		require.NoError(t, stmts.CreateAuthAttempt(t.Context(), attempt))

		plainToken := "handoff_" + RandString(12)
		sum := sha256.Sum256([]byte(plainToken))
		attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
		require.NoError(t, stmts.HandoffAuthAttempt(t.Context(), attempt))

		var session *domain.Session
		session, err = h.EnsureSessionService(t).Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: plainToken,
		})
		if err == nil {
			return session
		}
		// A rejected exchange returns before it deletes the attempt, so the
		// helper does: a failure must not leave rows in a shared project.
		require.NoError(t, stmts.DeleteAuthAttemptByID(t.Context(), projectID, attempt.ID))
		if !errors.Is(err, domain.ErrSessionInvalidHandoffToken()) {
			break
		}
		t.Logf("handoff expired before the exchange (slow database?): %v", err)
	}
	require.NoError(t, err)
	return nil
}
