//go:build postgres_integration

package service_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// newAuthAttemptServiceForIntegration wires the service with real statement pools.
// The password verifier is nil because these tests exercise only the
// user-proof path, which never touches it.
func newAuthAttemptServiceForIntegration(v2Pool service.StatementPool) service.AuthAttemptService {
	return service.NewAuthAttemptService(
		v2Pool,
		service.SessionStatementsResolver{Pool: v2Pool},
		service.UserStatementsLookup{Pool: v2Pool},
		nil,
	)
}

// issueUserChallenge creates a fresh attempt and binds a user challenge,
// returning the ids needed to drive VerifyProof.
func issueUserChallenge(t *testing.T, svc service.AuthAttemptService, projectID string) (attemptID, challengeID string) {
	t.Helper()
	attempt, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{ProjectID: projectID})
	require.NoError(t, err)

	issued, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attempt.ID,
		Challenge: service.UserChallenge{},
	})
	require.NoError(t, err)
	ch, ok := issued.ChallengeByType(domain.AuthCheckTypeUser)
	require.True(t, ok)
	return attempt.ID, ch.GetID()
}

func TestAuthAttemptService_VerifyProof_integration(t *testing.T) {
	svc := newAuthAttemptServiceForIntegration(integrationPoolOrFail(t))

	t.Run("user_not_found_records_failure_on_bound_challenge", func(t *testing.T) {
		projectID := "p-aa-not-found-" + time.Now().Format("150405.000000")
		ensureProject(t, projectID)
		attemptID, challengeID := issueUserChallenge(t, svc, projectID)

		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   projectID,
			AttemptID:   attemptID,
			ChallengeID: challengeID,
			Proof:       service.UserProof{AttributeName: "email", LoginName: "ghost@example.com"},
		})
		require.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))

		attempt, err := svc.GetByID(t.Context(), projectID, attemptID)
		require.NoError(t, err)
		ch, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, uint16(1), ch.GetFailureCount())
		assert.False(t, ch.GetLastFailedAt().IsZero())
	})

	t.Run("stale_challenge_id_leaves_row_untouched", func(t *testing.T) {
		projectID := "p-aa-stale-" + time.Now().Format("150405.000000")
		ensureProject(t, projectID)
		attemptID, _ := issueUserChallenge(t, svc, projectID)

		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   projectID,
			AttemptID:   attemptID,
			ChallengeID: "ch_does_not_exist",
			Proof:       service.UserProof{AttributeName: "email", LoginName: "alice@example.com"},
		})
		require.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())

		attempt, err := svc.GetByID(t.Context(), projectID, attemptID)
		require.NoError(t, err)
		ch, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Zero(t, ch.GetFailureCount())
		assert.True(t, ch.GetLastFailedAt().IsZero())
	})
}
