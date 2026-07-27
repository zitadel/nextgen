package service_test

import (
	"context"
	"encoding/base64"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

// newUserPasskeysMock returns a mock that resolves a passkey ListByUser lookup to the given keys.
func newUserPasskeysMock(ctrl *gomock.Controller, keys []*domain.UserPasskey) *mocks.MockUserPasskeys {
	m := mocks.NewMockUserPasskeys(ctrl)
	m.EXPECT().ListByUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(keys, nil)
	return m
}

const (
	passkeyRPID   = "example.com"
	passkeyOrigin = "https://example.com"
	passkeyUserID = "user-1"
)

// passkeyFixture wires a virtual authenticator and its matching stored passkey so service
// tests can drive a real challenge -> signed assertion -> verify round-trip.
type passkeyFixture struct {
	rp      virtualwebauthn.RelyingParty
	auth    virtualwebauthn.Authenticator
	cred    virtualwebauthn.Credential
	passkey *domain.UserPasskey
	origins []url.URL
}

func newPasskeyFixture(t *testing.T) passkeyFixture {
	t.Helper()

	rp := virtualwebauthn.RelyingParty{ID: passkeyRPID, Name: "Example", Origin: passkeyOrigin}
	auth := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(passkeyUserID),
	})
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	cred.Counter = 1
	auth.AddCredential(cred)

	origin, err := url.Parse(passkeyOrigin)
	require.NoError(t, err)

	return passkeyFixture{
		rp:   rp,
		auth: auth,
		cred: cred,
		passkey: &domain.UserPasskey{
			ProjectID:    "proj",
			UserID:       passkeyUserID,
			CredentialID: string(cred.ID),
			PublicKey:    cred.Key.AttestationData(),
			AAGUID:       auth.Aaguid[:],
		},
		origins: []url.URL{*origin},
	}
}

// challengeAttempt returns an attempt carrying a verified user factor and an issued passkey
// challenge with the given ID, plus the signed assertion bytes for that challenge.
func (f passkeyFixture) challengeAttempt(t *testing.T, challengeID string) (*domain.AuthAttempt, []byte) {
	t.Helper()

	challenge, err := domain.CreatePasskeyChallenge(passkeyUserID, []*domain.UserPasskey{f.passkey}, "preferred", passkeyRPID, f.origins)
	require.NoError(t, err)
	check := domain.SetAuthChallengePasskey(challengeID, time.Now(), time.Time{}, 0)
	check.PasskeyChallenge = challenge

	attempt := &domain.AuthAttempt{
		ProjectID: "proj",
		ID:        "att-1",
		Checks:    []domain.AuthCheck{&domain.AuthFactorUser{UserID: passkeyUserID}, check},
	}

	rawChallenge, err := base64.RawURLEncoding.DecodeString(challenge.Challenge)
	require.NoError(t, err)
	allowed := make([]string, 0, len(challenge.AllowedCredentialIDs))
	for _, id := range challenge.AllowedCredentialIDs {
		allowed = append(allowed, base64.RawURLEncoding.EncodeToString(id))
	}
	assertion := virtualwebauthn.CreateAssertionResponse(f.rp, f.auth, f.cred, virtualwebauthn.AssertionOptions{
		Challenge:        rawChallenge,
		RelyingPartyID:   challenge.RPID,
		AllowCredentials: allowed,
	})
	return attempt, []byte(assertion)
}

func TestAuthAttemptService_Create(t *testing.T) {
	sessionID := "sess-1"
	createErr := errors.New("create failed")
	unexpectedSessionErr := errors.New("session lookup failed")

	t.Run("creates attempt without session", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		// A nil session resolver mock with no expectations asserts it is never consulted.
		sessions := mocks.NewMockSessionResolver(ctrl)

		var created *domain.AuthAttempt
		repo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ database.QueryExecutor, a *domain.AuthAttempt) error {
				created = a
				return nil
			})

		svc := service.NewAuthAttemptService(nil, repo, sessions, nil, nil, nil, nil)
		got, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      "proj",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Same(t, got, created, "Create must persist and return the same attempt instance")
	})

	t.Run("copies session factors for step-up", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		sessions := mocks.NewMockSessionResolver(ctrl)

		sessions.EXPECT().Get(gomock.Any(), gomock.Any(), "proj", sessionID).
			Return(&domain.Session{Factors: []domain.AuthFactor{&domain.AuthFactorUser{UserID: "user-1"}}}, nil)
		repo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)

		svc := service.NewAuthAttemptService(nil, repo, sessions, nil, nil, nil, nil)
		got, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      "proj",
			SessionID:      &sessionID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		})

		require.NoError(t, err)
		require.NotNil(t, got.SessionID)
		assert.Equal(t, sessionID, *got.SessionID)
		_, ok := got.FactorByType(domain.AuthCheckTypeUser)
		assert.True(t, ok, "expected copied user factor from session")
	})

	t.Run("maps session not found to invalid request", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		sessions := mocks.NewMockSessionResolver(ctrl)

		sessions.EXPECT().Get(gomock.Any(), gomock.Any(), "proj", sessionID).
			Return(nil, domain.ErrSessionNotFound())
		// repo.Create has no expectation: gomock fails if it is called when session lookup fails.

		svc := service.NewAuthAttemptService(nil, repo, sessions, nil, nil, nil, nil)
		got, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      "proj",
			SessionID:      &sessionID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})

	t.Run("maps create repository failure to internal error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)

		repo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).Return(createErr)

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      "proj",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})

	t.Run("maps unexpected session error to internal", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		sessions := mocks.NewMockSessionResolver(ctrl)

		sessions.EXPECT().Get(gomock.Any(), gomock.Any(), "proj", sessionID).
			Return(nil, unexpectedSessionErr)

		svc := service.NewAuthAttemptService(nil, repo, sessions, nil, nil, nil, nil)
		got, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      "proj",
			SessionID:      &sessionID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})
}

func TestAuthAttemptService_GetByID(t *testing.T) {
	attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
	repoErr := errors.New("repo get failed")

	t.Run("returns repository attempt", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.GetByID(t.Context(), "proj", "att-1")

		require.NoError(t, err)
		assert.Same(t, attempt, got)
	})

	t.Run("propagates repository auth attempt not found error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").
			Return(nil, domain.ErrAuthAttemptNotFound())

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.GetByID(t.Context(), "proj", "att-1")

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
	})

	t.Run("maps repository error to internal error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(nil, repoErr)

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.GetByID(t.Context(), "proj", "att-1")

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrInternal(repoErr))
	})
}

type unsupportedChallenge struct{}

func (unsupportedChallenge) ChallengeCheckType() domain.AuthCheckType {
	return domain.AuthCheckTypeUnspecified
}

func TestAuthAttemptService_IssueChallenge(t *testing.T) {
	repoErr := errors.New("set challenge failed")

	t.Run("issues user challenge", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)

		var setChallenge domain.AuthChallenge
		repo.EXPECT().SetChallenge(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _, _ string, c domain.AuthChallenge) error {
				setChallenge = c
				return nil
			})

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj", AttemptID: "att-1", Challenge: service.UserChallenge{},
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		assert.IsType(t, &domain.AuthChallengeUser{}, setChallenge)
	})

	t.Run("issues password challenge when user factor exists", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		attempt := &domain.AuthAttempt{
			ProjectID: "proj",
			ID:        "att-1",
			Checks:    []domain.AuthCheck{&domain.AuthFactorUser{UserID: "user-1"}},
		}
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)

		var setChallenge domain.AuthChallenge
		repo.EXPECT().SetChallenge(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _, _ string, c domain.AuthChallenge) error {
				setChallenge = c
				return nil
			})

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj", AttemptID: "att-1", Challenge: service.PasswordChallenge{},
		})

		require.NoError(t, err)
		assert.IsType(t, &domain.AuthChallengePassword{}, setChallenge)
		assert.Same(t, attempt, got, "IssueChallenge must return loaded attempt")
	})

	t.Run("returns invalid request for unsupported challenge type", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)
		// SetChallenge has no expectation: it must not be called for an unsupported type.

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj", AttemptID: "att-1", Challenge: unsupportedChallenge{},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})

	t.Run("propagates set challenge error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)
		repo.EXPECT().SetChallenge(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any()).Return(repoErr)

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj", AttemptID: "att-1", Challenge: service.UserChallenge{},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, repoErr)
	})
}

func TestAuthAttemptService_VerifyProof(t *testing.T) {
	rejectErr := errors.New("user not found")
	succeedErr := errors.New("persist succeeded check failed")

	newUserChallengeAttempt := func() *domain.AuthAttempt {
		challenge := domain.SetAuthChallengeUser("ch-1", time.Now(), time.Time{}, 0)
		return &domain.AuthAttempt{
			ProjectID: "proj",
			ID:        "att-1",
			Checks:    []domain.AuthCheck{challenge},
		}
	}

	userProof := service.UserProof{AttributeName: "email", LoginName: "u@example.com"}

	t.Run("verifies user proof and persists success", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		users := mocks.NewMockUserLookup(ctrl)

		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(newUserChallengeAttempt(), nil)
		users.EXPECT().GetByAttributes(gomock.Any(), "proj", gomock.Any()).Return(&domain.User{ID: "user-1"}, nil)

		var succeededFactor domain.AuthFactor
		repo.EXPECT().ChallengeSucceeded(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any(), "ch-1").
			DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _, _ string, factor domain.AuthFactor, _ string) error {
				succeededFactor = factor
				return nil
			})

		svc := service.NewAuthAttemptService(nil, repo, nil, users, nil, nil, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: userProof,
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		userFactor, ok := succeededFactor.(*domain.AuthFactorUser)
		require.True(t, ok, "ChallengeSucceeded factor must be *domain.AuthFactorUser")
		assert.Equal(t, "user-1", userFactor.UserID)
	})

	t.Run("stale challenge returns error without recording failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		users := mocks.NewMockUserLookup(ctrl)

		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(newUserChallengeAttempt(), nil)
		// Prepare-phase failure: no challenge row identified, so neither the user lookup nor
		// ChallengeFailed must be reached. Their absence of expectations enforces that.

		svc := service.NewAuthAttemptService(nil, repo, nil, users, nil, nil, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "different", Proof: userProof,
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("user lookup rejection returns proof rejected and records failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		users := mocks.NewMockUserLookup(ctrl)

		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(newUserChallengeAttempt(), nil)
		users.EXPECT().GetByAttributes(gomock.Any(), "proj", gomock.Any()).Return(nil, rejectErr)

		var failedChallenge domain.AuthChallenge
		repo.EXPECT().ChallengeFailed(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _, _ string, c domain.AuthChallenge) error {
				failedChallenge = c
				return nil
			}).Times(1)

		svc := service.NewAuthAttemptService(nil, repo, nil, users, nil, nil, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: userProof,
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(rejectErr))
		assert.IsType(t, &domain.AuthChallengeUser{}, failedChallenge)
	})

	t.Run("propagates challenge succeeded persistence error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		users := mocks.NewMockUserLookup(ctrl)

		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(newUserChallengeAttempt(), nil)
		users.EXPECT().GetByAttributes(gomock.Any(), "proj", gomock.Any()).Return(&domain.User{ID: "user-1"}, nil)
		// ChallengeFailed must not be called: a persistence failure is not a proof rejection.
		repo.EXPECT().ChallengeSucceeded(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any(), "ch-1").Return(succeedErr)

		svc := service.NewAuthAttemptService(nil, repo, nil, users, nil, nil, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: userProof,
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, succeedErr)
	})
}

func TestAuthAttemptService_Handoff(t *testing.T) {
	repoErr := errors.New("handoff persist failed")

	completedAttempt := func() *domain.AuthAttempt {
		return &domain.AuthAttempt{
			ProjectID:      "proj",
			ID:             "att-1",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
		}
	}

	t.Run("creates and persists handoff for completed attempt", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(completedAttempt(), nil)

		var handed *domain.AuthAttempt
		repo.EXPECT().Handoff(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ database.QueryExecutor, a *domain.AuthAttempt) error {
				handed = a
				return nil
			})

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"})

		require.NoError(t, err)
		require.NotNil(t, got)
		assert.NotNil(t, got.HandoffToken, "HandoffToken must be generated")
		assert.Same(t, got, handed, "Handoff must persist the mutated attempt")
	})

	t.Run("returns not completed when required factors are missing", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(&domain.AuthAttempt{
			ProjectID:      "proj",
			ID:             "att-1",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		}, nil)
		// repo.Handoff has no expectation: it must not run on an incomplete attempt.

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptNotCompleted())
	})

	t.Run("propagates repository handoff failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(completedAttempt(), nil)
		repo.EXPECT().Handoff(gomock.Any(), gomock.Any(), gomock.Any()).Return(repoErr)

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, nil, nil)
		got, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, repoErr)
	})
}

func TestAuthAttemptService_IssuePasskeyChallenge(t *testing.T) {
	ctrl := gomock.NewController(t)
	f := newPasskeyFixture(t)

	attempt := &domain.AuthAttempt{
		ProjectID: "proj",
		ID:        "att-1",
		Checks:    []domain.AuthCheck{&domain.AuthFactorUser{UserID: passkeyUserID}},
	}
	repo := domainmock.NewMockAuthAttemptRepository(ctrl)
	repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)

	var setChallenge domain.AuthChallenge
	repo.EXPECT().SetChallenge(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _, _ string, c domain.AuthChallenge) error {
			setChallenge = c
			return nil
		})
	passkeys := newUserPasskeysMock(ctrl, []*domain.UserPasskey{f.passkey})

	svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, passkeys, nil)
	_, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
		ProjectID: "proj",
		AttemptID: "att-1",
		Challenge: service.PasskeyChallenge{UserVerification: "preferred", RPID: passkeyRPID, RPOrigins: f.origins},
	})
	require.NoError(t, err)

	challenge, ok := setChallenge.(*domain.AuthChallengePasskey)
	require.True(t, ok, "SetChallenge must receive a *domain.AuthChallengePasskey")
	assert.NotEmpty(t, challenge.Challenge, "issued passkey challenge must carry a WebAuthn challenge")
	assert.Equal(t, passkeyRPID, challenge.RPID)
}

func TestAuthAttemptService_VerifyPasskeyProof(t *testing.T) {
	t.Run("verifies assertion and persists success", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		f := newPasskeyFixture(t)
		attempt, assertion := f.challengeAttempt(t, "ch-1")

		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)

		var succeededFactor domain.AuthFactor
		repo.EXPECT().ChallengeSucceeded(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any(), "ch-1").
			DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _, _ string, factor domain.AuthFactor, _ string) error {
				succeededFactor = factor
				return nil
			})

		passkeys := newUserPasskeysMock(ctrl, []*domain.UserPasskey{f.passkey})
		// A successful assertion must persist the authenticator's advanced sign count and backup
		// state. gomock enforces that Update is called exactly once.
		var persistedSignCount int64
		passkeys.EXPECT().Update(
			gomock.Any(),
			"proj",
			passkeyUserID,
			domain.EncodePasskeyCredentialID(f.cred.ID),
			gomock.Any(),
			gomock.Any(),
			gomock.Any(),
		).DoAndReturn(func(_ context.Context, _, _, _ string, changes ...domain.UserPasskeyChange) error {
			for _, c := range changes {
				if c.Kind() == domain.UserPasskeyChangeSetSignCount {
					persistedSignCount = c.SignCount()
				}
			}
			return nil
		})

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, passkeys, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-1",
			Proof:       service.PasskeyProof{AssertionResponse: assertion},
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		factor, ok := succeededFactor.(*domain.AuthFactorPasskey)
		require.True(t, ok, "ChallengeSucceeded factor must be *domain.AuthFactorPasskey")
		assert.Equal(t, passkeyUserID, factor.UserID, "verified passkey factor must carry the user")
		assert.Equal(t, f.cred.ID, factor.CredentialID)
		// The fixture's authenticator reports counter 1, so the advanced sign count is persisted.
		assert.Equal(t, int64(1), persistedSignCount)
	})

	t.Run("rejects invalid assertion and records failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		f := newPasskeyFixture(t)
		attempt, _ := f.challengeAttempt(t, "ch-1")

		repo := domainmock.NewMockAuthAttemptRepository(ctrl)
		repo.EXPECT().GetByID(gomock.Any(), gomock.Any(), "proj", "att-1").Return(attempt, nil)
		repo.EXPECT().ChallengeFailed(gomock.Any(), gomock.Any(), "proj", "att-1", gomock.Any()).Return(nil).Times(1)
		// No Update expectation on passkeys: a rejected proof must not reach sign-count persistence.
		passkeys := newUserPasskeysMock(ctrl, []*domain.UserPasskey{f.passkey})

		svc := service.NewAuthAttemptService(nil, repo, nil, nil, nil, passkeys, nil)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-1",
			Proof:       service.PasskeyProof{AssertionResponse: []byte("not-a-valid-assertion")},
		})

		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
	})
}
