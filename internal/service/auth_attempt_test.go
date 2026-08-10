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
	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

func expectListUserPasskeys(stmts *mocks.MockAllStatements, keys []*domain.UserPasskey) {
	stmts.EXPECT().ListUserPasskeys(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.UserPasskey]{Items: keys}, nil)
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

func newAuthAttemptSvc(
	ctrl *gomock.Controller,
	stmts *mocks.MockAllStatements,
	sessions service.SessionResolver,
	users service.UserLookup,
) service.AuthAttemptService {
	return newAuthAttemptSvcWithVerifier(ctrl, stmts, sessions, users, nil)
}

func newAuthAttemptSvcWithVerifier(
	ctrl *gomock.Controller,
	stmts *mocks.MockAllStatements,
	sessions service.SessionResolver,
	users service.UserLookup,
	verifier crypto.HashVerifier,
) service.AuthAttemptService {
	pool := mocks.NewMockPool(ctrl)
	statementer := mocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return service.NewAuthAttemptService(service.NewPool(pool), sessions, users, verifier)
}

func TestAuthAttemptService_Create(t *testing.T) {
	sessionID := "sess-1"
	createErr := errors.New("create failed")
	unexpectedSessionErr := errors.New("session lookup failed")

	t.Run("creates attempt without session", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		sessions := mocks.NewMockSessionResolver(ctrl)

		var created *domain.AuthAttempt
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().CreateAuthAttempt(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, a *domain.AuthAttempt) error {
			created = a
			return nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, sessions, nil)
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
		sessions := mocks.NewMockSessionResolver(ctrl)

		sessions.EXPECT().Get(gomock.Any(), "proj", sessionID).
			Return(&domain.Session{Factors: []domain.AuthFactor{&domain.AuthFactorUser{UserID: "user-1"}}}, nil)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().CreateAuthAttempt(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, *domain.AuthAttempt) error { return nil })

		svc := newAuthAttemptSvc(ctrl, stmts, sessions, nil)
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
		sessions := mocks.NewMockSessionResolver(ctrl)

		sessions.EXPECT().Get(gomock.Any(), "proj", sessionID).
			Return(nil, domain.ErrSessionNotFound())

		svc := newAuthAttemptSvc(ctrl, mocks.NewMockAllStatements(ctrl), sessions, nil)
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
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().CreateAuthAttempt(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, *domain.AuthAttempt) error { return createErr })

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      "proj",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})

	t.Run("maps unexpected session error to internal", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		sessions := mocks.NewMockSessionResolver(ctrl)

		sessions.EXPECT().Get(gomock.Any(), "proj", sessionID).
			Return(nil, unexpectedSessionErr)

		svc := newAuthAttemptSvc(ctrl, mocks.NewMockAllStatements(ctrl), sessions, nil)
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
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, projectID, id string) (*domain.AuthAttempt, error) {
			assert.Equal(t, "proj", projectID)
			assert.Equal(t, "att-1", id)
			return attempt, nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.GetByID(t.Context(), "proj", "att-1")

		require.NoError(t, err)
		assert.Same(t, attempt, got)
	})

	t.Run("propagates repository auth attempt not found error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return nil, domain.ErrAuthAttemptNotFound()
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.GetByID(t.Context(), "proj", "att-1")

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
	})

	t.Run("maps repository error to internal error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return nil, repoErr
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
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
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
		var setChallenge domain.AuthChallenge
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return attempt, nil
		})
		stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, c domain.AuthChallenge) error {
			setChallenge = c
			return nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj", AttemptID: "att-1", Challenge: service.UserChallenge{},
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		assert.IsType(t, &domain.AuthChallengeUser{}, setChallenge)
	})

	t.Run("issues password challenge when user factor exists", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		attempt := &domain.AuthAttempt{
			ProjectID: "proj",
			ID:        "att-1",
			Checks:    []domain.AuthCheck{&domain.AuthFactorUser{UserID: "user-1"}},
		}
		var setChallenge domain.AuthChallenge
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return attempt, nil
		})
		stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, c domain.AuthChallenge) error {
			setChallenge = c
			return nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj", AttemptID: "att-1", Challenge: service.PasswordChallenge{},
		})

		require.NoError(t, err)
		assert.IsType(t, &domain.AuthChallengePassword{}, setChallenge)
		assert.Same(t, attempt, got, "IssueChallenge must return loaded attempt")
	})

	t.Run("returns invalid request for unsupported challenge type", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return attempt, nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj", AttemptID: "att-1", Challenge: unsupportedChallenge{},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})

	t.Run("propagates set challenge error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return attempt, nil
		})
		stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string, domain.AuthChallenge) error {
			return repoErr
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
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
		users := mocks.NewMockUserLookup(ctrl)

		var succeededFactor domain.AuthFactor
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return newUserChallengeAttempt(), nil
		})
		stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, factor domain.AuthFactor, _ string) error {
			succeededFactor = factor
			return nil
		})
		users.EXPECT().GetByAttributes(gomock.Any(), "proj", gomock.Any()).Return(&domain.User{ID: "user-1"}, nil)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, users)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: userProof,
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		require.IsType(t, &domain.AuthFactorUser{}, succeededFactor, "ChallengeSucceeded factor must be *domain.AuthFactorUser")
		userFactor := succeededFactor.(*domain.AuthFactorUser)
		assert.Equal(t, "user-1", userFactor.UserID)
	})

	t.Run("stale challenge returns error without recording failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		users := mocks.NewMockUserLookup(ctrl)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return newUserChallengeAttempt(), nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, users)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "different", Proof: userProof,
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("user lookup rejection returns proof rejected and records failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		users := mocks.NewMockUserLookup(ctrl)

		var failedChallenge domain.AuthChallenge
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return newUserChallengeAttempt(), nil
		})
		stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, c domain.AuthChallenge) error {
			failedChallenge = c
			return nil
		})
		users.EXPECT().GetByAttributes(gomock.Any(), "proj", gomock.Any()).Return(nil, rejectErr)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, users)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: userProof,
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(rejectErr))
		assert.IsType(t, &domain.AuthChallengeUser{}, failedChallenge)
	})

	t.Run("propagates challenge succeeded persistence error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		users := mocks.NewMockUserLookup(ctrl)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return newUserChallengeAttempt(), nil
		})
		// ChallengeFailed must not be called: a persistence failure is not a proof rejection.
		stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string, domain.AuthFactor, string) error {
			return succeedErr
		})
		users.EXPECT().GetByAttributes(gomock.Any(), "proj", gomock.Any()).Return(&domain.User{ID: "user-1"}, nil)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, users)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1", Proof: userProof,
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, succeedErr)
	})
}

func TestAuthAttemptService_VerifyProof_Password(t *testing.T) {
	lookupErr := errors.New("password missing")

	newPasswordChallengeAttempt := func() *domain.AuthAttempt {
		return &domain.AuthAttempt{
			ProjectID: "proj",
			ID:        "att-1",
			Checks: []domain.AuthCheck{
				&domain.AuthFactorUser{UserID: "user-1"},
				domain.SetAuthChallengePassword("ch-pass", time.Now(), time.Time{}, 0),
			},
		}
	}

	t.Run("loads password via stmts and persists success", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		verifier := cryptomock.NewMockHashVerifier(ctrl)
		var succeededFactor domain.AuthFactor
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return newPasswordChallengeAttempt(), nil
		})
		stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{
			ProjectID:   "proj",
			UserID:      "user-1",
			EncodedHash: "encoded",
		}, nil)
		verifier.EXPECT().VerifyHash("encoded", "secret").Return(nil)
		stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, factor domain.AuthFactor, _ string) error {
			succeededFactor = factor
			return nil
		})

		svc := newAuthAttemptSvcWithVerifier(ctrl, stmts, nil, nil, verifier)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-pass",
			Proof: service.PasswordProof{Password: "secret"},
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		assert.IsType(t, &domain.AuthFactorPassword{}, succeededFactor)
	})

	t.Run("missing password returns proof rejected and records failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		var failedChallenge domain.AuthChallenge
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return newPasswordChallengeAttempt(), nil
		})
		stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(nil, lookupErr)
		stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, c domain.AuthChallenge) error {
			failedChallenge = c
			return nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-pass",
			Proof: service.PasswordProof{Password: "secret"},
		})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(lookupErr))
		assert.IsType(t, &domain.AuthChallengePassword{}, failedChallenge)
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
		var handed *domain.AuthAttempt
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return completedAttempt(), nil
		})
		stmts.EXPECT().HandoffAuthAttempt(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, a *domain.AuthAttempt) error {
			handed = a
			return nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"})

		require.NoError(t, err)
		require.NotNil(t, got)
		assert.NotNil(t, got.HandoffToken, "HandoffToken must be generated")
		assert.Same(t, got, handed, "Handoff must persist the mutated attempt")
	})

	t.Run("returns not completed when required factors are missing", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return &domain.AuthAttempt{
				ProjectID:      "proj",
				ID:             "att-1",
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			}, nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: "proj", AttemptID: "att-1"})

		assert.Nil(t, got)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptNotCompleted())
	})

	t.Run("propagates repository handoff failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return completedAttempt(), nil
		})
		stmts.EXPECT().HandoffAuthAttempt(gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, *domain.AuthAttempt) error {
			return repoErr
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
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
	var setChallenge domain.AuthChallenge
	stmts := mocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
		return attempt, nil
	})
	stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, c domain.AuthChallenge) error {
		setChallenge = c
		return nil
	})
	expectListUserPasskeys(stmts, []*domain.UserPasskey{f.passkey})

	svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
	_, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
		ProjectID: "proj",
		AttemptID: "att-1",
		Challenge: service.PasskeyChallenge{UserVerification: "preferred", RPID: passkeyRPID, RPOrigins: f.origins},
	})
	require.NoError(t, err)

	require.IsType(t, &domain.AuthChallengePasskey{}, setChallenge, "SetChallenge must receive a *domain.AuthChallengePasskey")
	challenge := setChallenge.(*domain.AuthChallengePasskey)
	assert.NotEmpty(t, challenge.Challenge, "issued passkey challenge must carry a WebAuthn challenge")
	assert.Equal(t, passkeyRPID, challenge.RPID)
}

func TestAuthAttemptService_VerifyPasskeyProof(t *testing.T) {
	t.Run("verifies assertion and persists success", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		f := newPasskeyFixture(t)
		attempt, assertion := f.challengeAttempt(t, "ch-1")

		var succeededFactor domain.AuthFactor
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return attempt, nil
		})
		stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, _, _ string, factor domain.AuthFactor, _ string) error {
			succeededFactor = factor
			return nil
		})

		expectListUserPasskeys(stmts, []*domain.UserPasskey{f.passkey})
		var persistedSignCount int64
		stmts.EXPECT().UpdateUserPasskey(
			gomock.Any(),
			gomock.Any(),
			gomock.Any(),
			gomock.Any(),
			gomock.Any(),
		).DoAndReturn(func(_ context.Context, _ database.Filter[domain.UserPasskeyField], updates ...domain.UserPasskeyUpdate) error {
			for _, u := range updates {
				if sc, ok := u.(*domain.UserPasskeySignCountUpdate); ok {
					persistedSignCount = sc.SignCount
				}
			}
			return nil
		})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-1",
			Proof:       service.PasskeyProof{AssertionResponse: assertion},
		})

		require.NoError(t, err)
		require.NotNil(t, got)
		require.IsType(t, &domain.AuthFactorPasskey{}, succeededFactor, "ChallengeSucceeded factor must be *domain.AuthFactorPasskey")
		factor := succeededFactor.(*domain.AuthFactorPasskey)
		assert.Equal(t, passkeyUserID, factor.UserID, "verified passkey factor must carry the user")
		assert.Equal(t, f.cred.ID, factor.CredentialID)
		assert.Equal(t, int64(1), persistedSignCount)
	})

	t.Run("rejects invalid assertion and records failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		f := newPasskeyFixture(t)
		attempt, _ := f.challengeAttempt(t, "ch-1")

		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string) (*domain.AuthAttempt, error) {
			return attempt, nil
		})
		stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(context.Context, string, string, domain.AuthChallenge) error {
			return nil
		})
		expectListUserPasskeys(stmts, []*domain.UserPasskey{f.passkey})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-1",
			Proof:       service.PasskeyProof{AssertionResponse: []byte("not-a-valid-assertion")},
		})

		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
	})
}
