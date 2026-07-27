package helpers

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func (h *Harness) EnsureUserService(t *testing.T) *service.UserService {
	t.Helper()
	h.userService.mutex.Lock()
	defer h.userService.mutex.Unlock()

	if h.userService.value == nil {
		h.userService.value = service.NewUserService(
			h.EnsureDBPool(t),
			h.EnsureServiceDB(t),
			h.EnsureSchemaStore(t),
			h.EnsureUserPasswordRepo(t),
			h.EnsureHasher(t),
		)
	}
	return h.userService.value
}

// UserFixture exposes UserStatements helpers for integration tests.
type UserFixture struct {
	Pool *service.DB
}

func (h *Harness) EnsureUserFixture(t *testing.T) UserFixture {
	t.Helper()
	return UserFixture{Pool: h.EnsureServiceDB(t)}
}

func (f UserFixture) Create(ctx context.Context, user *domain.CreateUser) error {
	return f.Pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return tx.Statements().CreateUser(ctx, user)
	})
}

func (f UserFixture) GetByID(ctx context.Context, projectID, userID string) (*domain.User, error) {
	return f.Pool.Statements().GetUser(ctx, v2database.And(
		v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID),
		v2database.Equal(v2database.Col(domain.UserFieldID), userID),
	), service.UserQueryOptions{})
}

func (f UserFixture) GetByAttributes(ctx context.Context, projectID string, attrs []domain.Attribute) (*domain.User, error) {
	return f.Pool.Statements().GetUser(ctx,
		v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID),
		service.UserQueryOptions{Attributes: attrs},
	)
}

func CreateSessionUsingPassword(t *testing.T,
	authAttempts service.AuthAttemptService,
	sessionService service.SessionService,
	projectID string, userEmail string, userPassword string) (*domain.Session, error) {
	attempt, err := authAttempts.Create(t.Context(), service.CreateAuthAttemptInput{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword},
	})
	if err != nil {
		return nil, err
	}

	attempt, err = authAttempts.IssueChallenge(t.Context(), service.IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attempt.ID,
		Challenge: service.UserChallenge{},
	})
	if err != nil {
		return nil, err
	}
	userChallenge, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
	require.True(t, ok)

	attempt, err = authAttempts.VerifyProof(t.Context(), service.VerifyProofInput{
		ProjectID:   projectID,
		AttemptID:   attempt.ID,
		ChallengeID: userChallenge.GetID(),
		Proof: service.UserProof{
			AttributeName: "email",
			LoginName:     userEmail,
		},
	})
	if err != nil {
		return nil, err
	}

	attempt, err = authAttempts.IssueChallenge(t.Context(), service.IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attempt.ID,
		Challenge: service.PasswordChallenge{},
	})
	if err != nil {
		return nil, err
	}
	passwordChallenge, ok := attempt.ChallengeByType(domain.AuthCheckTypePassword)
	require.True(t, ok)

	attempt, err = authAttempts.VerifyProof(t.Context(), service.VerifyProofInput{
		ProjectID:   projectID,
		AttemptID:   attempt.ID,
		ChallengeID: passwordChallenge.GetID(),
		Proof:       service.PasswordProof{Password: userPassword},
	})
	if err != nil {
		return nil, err
	}
	assert.True(t, attempt.IsCompleted())

	attempt, err = authAttempts.Handoff(t.Context(), service.HandoffInput{
		ProjectID: projectID,
		AttemptID: attempt.ID,
	})
	if err != nil {
		return nil, err
	}
	require.NotNil(t, attempt.HandoffToken)

	session, err := sessionService.Exchange(t.Context(), service.ExchangeInput{
		ProjectID:    projectID,
		HandoffToken: attempt.HandoffToken.Plain(),
	})
	if err != nil {
		return nil, err
	}
	return session, nil
}
