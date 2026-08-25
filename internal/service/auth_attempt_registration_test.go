package service_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

func passkeyTestOrigins(t *testing.T) []url.URL {
	t.Helper()
	origin, err := url.Parse(passkeyOrigin)
	require.NoError(t, err)
	return []url.URL{*origin}
}

// registrationChallengeAttempt returns an attempt carrying an issued passkey
// registration challenge plus the creation options a client would answer.
func registrationChallengeAttempt(t *testing.T, userID string, provisional bool, challengedAt time.Time) (*domain.AuthAttempt, []byte) {
	t.Helper()
	registrationChallenge, err := domain.CreatePasskeyRegistrationChallenge(
		userID, "alice@example.com", "Alice Example", nil, passkeyRPID, passkeyTestOrigins(t))
	require.NoError(t, err)
	check := domain.SetAuthChallengePasskeyRegistration("ch-reg-1", challengedAt, time.Time{}, 0)
	check.PasskeyRegistrationChallenge = registrationChallenge
	check.Provisional = provisional

	attempt := &domain.AuthAttempt{
		ProjectID: "proj",
		ID:        "att-1",
		Checks:    []domain.AuthCheck{check},
	}
	options, err := domain.BuildPasskeyCreationOptions(check)
	require.NoError(t, err)
	return attempt, options
}

// attestRegistration answers creation options with a real attestation from a
// fresh virtual authenticator.
func attestRegistration(t *testing.T, options []byte) []byte {
	t.Helper()

	rp := virtualwebauthn.RelyingParty{ID: passkeyRPID, Name: "Example", Origin: passkeyOrigin}
	auth := virtualwebauthn.NewAuthenticator()
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	auth.AddCredential(cred)

	attestationOptions, err := virtualwebauthn.ParseAttestationOptions(string(options))
	require.NoError(t, err)

	return []byte(virtualwebauthn.CreateAttestationResponse(rp, auth, cred, *attestationOptions))
}

func TestAuthAttemptService_IssueChallenge_PasskeyRegistration(t *testing.T) {
	t.Run("provisional mints a user handle without listing passkeys", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").
			Return(&domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}, nil)
		stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_minted01", nil)
		stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), "proj", "att-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _, _ string, ch domain.AuthChallenge) error {
				ch.SetID("ch-reg-1")
				ch.SetLastChallengedAt(time.Now())
				return nil
			})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		attempt, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj",
			AttemptID: "att-1",
			Challenge: service.PasskeyRegistrationChallenge{
				Username:  "alice@example.com",
				RPID:      passkeyRPID,
				RPOrigins: passkeyTestOrigins(t),
			},
		})
		require.NoError(t, err)

		check, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		registration, ok := check.(*domain.AuthChallengePasskeyRegistration)
		require.True(t, ok)
		assert.True(t, registration.Provisional)
		assert.Equal(t, "user_minted01", registration.UserID)
		assert.Empty(t, registration.ExcludeIDs)
	})

	t.Run("pinned user excludes existing credentials", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").
			Return(&domain.AuthAttempt{
				ProjectID: "proj", ID: "att-1",
				Checks: []domain.AuthCheck{&domain.AuthFactorUser{UserID: passkeyUserID}},
			}, nil)
		expectListUserPasskeys(stmts, []*domain.UserPasskey{{
			ProjectID:    "proj",
			UserID:       passkeyUserID,
			CredentialID: base64.RawURLEncoding.EncodeToString([]byte("existing-cred")),
		}})
		stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), "proj", "att-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _, _ string, ch domain.AuthChallenge) error {
				ch.SetID("ch-reg-1")
				ch.SetLastChallengedAt(time.Now())
				return nil
			})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		attempt, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj",
			AttemptID: "att-1",
			Challenge: service.PasskeyRegistrationChallenge{
				RPID:      passkeyRPID,
				RPOrigins: passkeyTestOrigins(t),
			},
		})
		require.NoError(t, err)

		check, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		registration := check.(*domain.AuthChallengePasskeyRegistration)
		assert.False(t, registration.Provisional)
		assert.Equal(t, passkeyUserID, registration.UserID)
		assert.Len(t, registration.ExcludeIDs, 1)
	})

	t.Run("caller-chosen handle for a fresh ceremony is replaced by a mint", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").
			Return(&domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}, nil)
		stmts.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_minted01", nil)
		stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), "proj", "att-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _, _ string, ch domain.AuthChallenge) error {
				ch.SetID("ch-reg-1")
				ch.SetLastChallengedAt(time.Now())
				return nil
			})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		attempt, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj",
			AttemptID: "att-1",
			Challenge: service.PasskeyRegistrationChallenge{
				UserID:    "user_attacker_chosen",
				RPID:      passkeyRPID,
				RPOrigins: passkeyTestOrigins(t),
			},
		})
		require.NoError(t, err)

		check, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		registration := check.(*domain.AuthChallengePasskeyRegistration)
		assert.True(t, registration.Provisional)
		assert.Equal(t, "user_minted01", registration.UserID,
			"a caller-chosen handle must never become the ceremony's user id")
	})

	t.Run("re-issue keeps the in-flight provisional handle", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		priorAttempt, _ := registrationChallengeAttempt(t, "user_minted01", true, time.Now())
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(priorAttempt, nil)
		// No NewManagedID expectation: the prior ceremony's handle is kept.
		stmts.EXPECT().SetAuthAttemptChallenge(gomock.Any(), "proj", "att-1", gomock.Any()).
			DoAndReturn(func(_ context.Context, _, _ string, ch domain.AuthChallenge) error {
				ch.SetID("ch-reg-2")
				ch.SetLastChallengedAt(time.Now())
				return nil
			})

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		attempt, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj",
			AttemptID: "att-1",
			Challenge: service.PasskeyRegistrationChallenge{
				UserID:    "user_minted01",
				RPID:      passkeyRPID,
				RPOrigins: passkeyTestOrigins(t),
			},
		})
		require.NoError(t, err)

		check, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		registration := check.(*domain.AuthChallengePasskeyRegistration)
		assert.True(t, registration.Provisional)
		assert.Equal(t, "user_minted01", registration.UserID)
	})

	t.Run("pinned user rejects a mismatching requested user", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").
			Return(&domain.AuthAttempt{
				ProjectID: "proj", ID: "att-1",
				Checks: []domain.AuthCheck{&domain.AuthFactorUser{UserID: passkeyUserID}},
			}, nil)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		_, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: "proj",
			AttemptID: "att-1",
			Challenge: service.PasskeyRegistrationChallenge{
				UserID:    "someone-else",
				RPID:      passkeyRPID,
				RPOrigins: passkeyTestOrigins(t),
			},
		})
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})
}

func TestAuthAttemptService_VerifyProof_PasskeyRegistration(t *testing.T) {
	t.Run("provisional creates user, credential, and factors in one transaction", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		var events []*domain.Event
		stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, ev *domain.Event) error {
				events = append(events, ev)
				return nil
			}).AnyTimes()
		attempt, options := registrationChallengeAttempt(t, "user_minted01", true, time.Now())
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)

		var createdPasskey *domain.CreateUserPasskey
		var userFactor domain.AuthFactor
		var succeededFactor domain.AuthFactor
		createUser := mocks.NewMockUserAction(ctrl)
		gomock.InOrder(
			createUser.EXPECT().Prepare(gomock.Any()).Return(nil),
			createUser.EXPECT().Apply(gomock.Any(), gomock.Any()).Return(nil),
			stmts.EXPECT().CreateUserPasskey(gomock.Any(), gomock.Any()).
				DoAndReturn(func(_ context.Context, p *domain.CreateUserPasskey) error {
					p.ID = "upk_test01"
					createdPasskey = p
					return nil
				}),
			stmts.EXPECT().SetAuthAttemptFactor(gomock.Any(), "proj", "att-1", gomock.Any()).
				DoAndReturn(func(_ context.Context, _, _ string, factor domain.AuthFactor) (string, error) {
					userFactor = factor
					return "ch-user-1", nil
				}),
			stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), "proj", "att-1", gomock.Any(), "ch-reg-1").
				DoAndReturn(func(_ context.Context, _, _ string, factor domain.AuthFactor, _ string) error {
					succeededFactor = factor
					return nil
				}),
		)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		got, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-reg-1",
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				Name:                "Work laptop",
				CreateUser: func(userID string) []service.UserAction {
					assert.Equal(t, "user_minted01", userID,
						"the factory must receive the challenge's authoritative handle")
					return []service.UserAction{createUser}
				},
			},
		})
		require.NoError(t, err)

		require.NotNil(t, createdPasskey)
		assert.Equal(t, "proj", createdPasskey.ProjectID)
		assert.Equal(t, "user_minted01", createdPasskey.UserID)
		assert.Equal(t, "Work laptop", createdPasskey.Name)

		require.NotNil(t, userFactor)
		user, ok := userFactor.(*domain.AuthFactorUser)
		require.True(t, ok)
		assert.Equal(t, "user_minted01", user.UserID)

		registration, ok := succeededFactor.(*domain.AuthFactorPasskeyRegistration)
		require.True(t, ok)
		assert.Equal(t, "user_minted01", registration.UserID)
		assert.Equal(t, createdPasskey.CredentialID, registration.CredentialID)

		gotUser, ok := got.FactorByType(domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, "user_minted01", gotUser.(*domain.AuthFactorUser).UserID)
		_, ok = got.FactorByType(domain.AuthCheckTypePasskeyRegistration)
		assert.True(t, ok)

		// The credential row's identity rides on the factor.
		assert.Equal(t, "upk_test01", registration.PasskeyID)
		assert.Equal(t, "Work laptop", registration.Name)

		// The directly-set user factor emits its own check-succeeded event.
		var userCheckEvents int
		for _, ev := range events {
			if ev.EventType != domain.EventTypeAuthCheckSucceeded {
				continue
			}
			var payload domain.AuthCheckPayload
			require.NoError(t, json.Unmarshal(ev.Payload, &payload))
			if payload.CheckID == "ch-user-1" {
				userCheckEvents++
				assert.Equal(t, domain.AuthCheckTypeUser.String(), payload.CheckType)
				assert.Equal(t, "att-1", payload.AuthAttemptID)
			}
		}
		assert.Equal(t, 1, userCheckEvents, "the user factor must emit exactly one auth.check.succeeded event")
	})

	t.Run("existing user skips the create-user actions", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		attempt, options := registrationChallengeAttempt(t, passkeyUserID, false, time.Now())
		attempt.SetCheck(&domain.AuthFactorUser{UserID: passkeyUserID})
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)

		var createdPasskey *domain.CreateUserPasskey
		stmts.EXPECT().CreateUserPasskey(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, p *domain.CreateUserPasskey) error {
				p.ID = "upk_test01"
				createdPasskey = p
				return nil
			})
		// No SetAuthAttemptFactor expectation: the user factor is proof-backed
		// and must not be rewritten (nor re-emitted) by an enrollment.
		stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), "proj", "att-1", gomock.Any(), "ch-reg-1").Return(nil)

		// No Prepare/Apply expectations: applying it would fail the test.
		createUser := mocks.NewMockUserAction(ctrl)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-reg-1",
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				CreateUser: func(string) []service.UserAction { return []service.UserAction{createUser} },
			},
		})
		require.NoError(t, err)
		require.NotNil(t, createdPasskey)
		assert.Equal(t, passkeyUserID, createdPasskey.UserID)
		assert.NotEmpty(t, createdPasskey.Name, "a fallback name must be derived when none is supplied")
	})

	t.Run("invalid attestation bumps the failure count", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		attempt, _ := registrationChallengeAttempt(t, "user_minted01", true, time.Now())
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)
		stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), "proj", "att-1", gomock.Any()).Return(nil)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-reg-1",
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: []byte(`{"not":"valid-webauthn"}`),
			},
		})
		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
	})

	t.Run("challenge older than the ceremony TTL is stale without a failure bump", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		attempt, options := registrationChallengeAttempt(t, "user_minted01", true,
			time.Now().Add(-domain.PasskeyRegistrationChallengeTTL-time.Minute))
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-reg-1",
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
			},
		})
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("create-user prepare error aborts before any write", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		attempt, options := registrationChallengeAttempt(t, "user_minted01", true, time.Now())
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)

		createUser := mocks.NewMockUserAction(ctrl)
		createUser.EXPECT().Prepare(gomock.Any()).Return(domain.ErrUserInvalid())

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-reg-1",
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				CreateUser: func(string) []service.UserAction { return []service.UserAction{createUser} },
			},
		})
		assert.ErrorIs(t, err, domain.ErrUserInvalid())
	})

	t.Run("user_already_exists rolls back without a failure bump", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		attempt, options := registrationChallengeAttempt(t, "user_minted01", true, time.Now())
		stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), "proj", "att-1").Return(attempt, nil)

		createUser := mocks.NewMockUserAction(ctrl)
		createUser.EXPECT().Prepare(gomock.Any()).Return(nil)
		createUser.EXPECT().Apply(gomock.Any(), gomock.Any()).Return(domain.ErrUserAlreadyExists())

		svc := newAuthAttemptSvc(ctrl, stmts, nil, nil)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   "proj",
			AttemptID:   "att-1",
			ChallengeID: "ch-reg-1",
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				CreateUser: func(string) []service.UserAction { return []service.UserAction{createUser} },
			},
		})
		assert.ErrorIs(t, err, domain.ErrUserAlreadyExists())
	})
}
