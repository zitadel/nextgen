//go:build postgres_integration

package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// plainHasher keeps the password readable: the test is about the order of
// checks and writes, not about hashing.
type plainHasher struct{}

func (plainHasher) Hash(_ context.Context, password string) (string, error) {
	return "plain$" + password, nil
}

func (plainHasher) VerifyHash(_ context.Context, encoded, password string) error {
	if encoded == "plain$"+password {
		return nil
	}
	return crypto.ErrHashMismatch
}

// Two self-service changes to the same new password are both checked against
// the history before either writes. The first lands; the second must not set
// the password the first one just made current, whether it writes after the
// first committed or while the first is still open.
func TestSetPasswordAction_StaleHistoryCheck_integration(t *testing.T) {
	pool := integrationPoolOrFail(t)
	projectID := "p-pw-history-" + uniqueIntegrationSuffix(t)
	ensureProject(t, projectID)
	ensureUserSchema(t, projectID)
	create := service.NewCreateUserAction(service.CreateUserInput{
		ProjectID:  projectID,
		SchemaURL:  registrationTestSchemaURL,
		Attributes: map[string]any{"email": "history@example.com"},
	}, pool.Statements())
	require.NoError(t, create.Prepare(t.Context()))
	require.NoError(t, create.Apply(t.Context(), pool.Statements()))
	userID := create.CreateUser.ID

	gate := newGate(t, fixedPolicy{config: map[string]any{"history_depth": 1}}, plainHasher{}, pool)
	change := func(password string) *service.SetPasswordUserAction {
		return service.NewSetUserPasswordAction(service.SetPasswordInput{
			ProjectID:   projectID,
			UserID:      userID,
			Password:    password,
			SelfService: true,
		}, service.FixedProjectHasherResolver{Hasher: plainHasher{}}, gate)
	}
	apply := func(action *service.SetPasswordUserAction) error {
		return pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return action.Apply(ctx, tx.Statements())
		})
	}

	initial := change("initial password")
	require.NoError(t, initial.Prepare(t.Context()))
	require.NoError(t, apply(initial))

	first, second := change("new password"), change("new password")
	require.NoError(t, first.Prepare(t.Context()))
	require.NoError(t, second.Prepare(t.Context()), "both are checked against the initial password")
	require.NoError(t, apply(first))
	require.ErrorIs(t, apply(second), domain.ErrUserConflict())

	byUser := database.And(
		database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
	)
	current, err := pool.Statements().GetUserPassword(t.Context(), byUser)
	require.NoError(t, err)
	assert.Equal(t, "plain$new password", current.EncodedHash)
	history, err := pool.Statements().GetUserPasswordHistory(t.Context(), projectID, userID)
	require.NoError(t, err)
	require.Len(t, history, 1, "the rejected change left nothing behind")
	assert.Equal(t, "plain$initial password", history[0].EncodedHash)

	assert.Equal(t, map[string]any{"history_depth": int64(1)}, violations(t, change("new password").Prepare(t.Context())),
		"retried, the check compares against the password the first change set")

	// The same with both writes in flight: the second waits on the user's
	// lock the first holds, then sees the first's password as the one it
	// replaced.
	third, fourth := change("third password"), change("third password")
	require.NoError(t, third.Prepare(t.Context()))
	require.NoError(t, fourth.Prepare(t.Context()))
	fourthDone := make(chan error, 1)
	require.NoError(t, pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		if err := third.Apply(ctx, tx.Statements()); err != nil {
			return err
		}
		go func() { fourthDone <- apply(fourth) }()
		select {
		case err := <-fourthDone:
			t.Errorf("the second write finished while the first held the lock: %v", err)
		case <-time.After(300 * time.Millisecond):
		}
		return nil
	}))
	select {
	case err := <-fourthDone:
		require.ErrorIs(t, err, domain.ErrUserConflict())
	case <-time.After(10 * time.Second):
		t.Fatal("the second write did not finish after the first committed")
	}
}
