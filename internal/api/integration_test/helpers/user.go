package helpers

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserService(t *testing.T) *service.UserService {
	t.Helper()
	h.mu.Lock()
	svc := h.UserService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewUserService(
		h.EnsureDBPool(t),
		h.EnsureUserRepo(t),
		h.EnsureUserPasswordRepo(t),
		h.EnsureSchemaRepo(t),
		h.EnsureDecrypter(t),
		h.EnsureHasher(t),
	)
	h.mu.Lock()
	if h.UserService == nil {
		h.UserService = svc
	}
	svc = h.UserService
	h.mu.Unlock()
	return svc
}

func (h *Harness) EnsureUserRepo(t *testing.T) domain.UserRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.UserRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewUserRepository()
	h.mu.Lock()
	if h.UserRepo == nil {
		h.UserRepo = repo
	}
	repo = h.UserRepo
	h.mu.Unlock()
	return repo
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
