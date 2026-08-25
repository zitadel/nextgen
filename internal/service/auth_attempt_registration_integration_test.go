//go:build postgres_integration

package service_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const registrationTestSchemaURL = "https://example.test/user-schema.json"

func uniqueIntegrationSuffix(t *testing.T) string {
	t.Helper()
	return time.Now().Format("150405.000000")
}

func ensureUserSchema(t *testing.T, projectID string) {
	t.Helper()
	pool := integrationPoolOrFail(t)
	err := pool.Statements().CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: projectID,
		URL:       registrationTestSchemaURL,
		Schema: []byte(`{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"$id": "` + registrationTestSchemaURL + `",
			"type": "object",
			"properties": {
				"email": {"type": "string", "format": "email", "x-unique": "project"}
			}
		}`),
	})
	require.NoError(t, err)
}

func newRegistrationCreateUserAction(t *testing.T, projectID, userID, email string) service.UserAction {
	t.Helper()
	pool := integrationPoolOrFail(t)
	return service.NewCreateUserAction(service.CreateUserInput{
		ProjectID:  projectID,
		SchemaURL:  registrationTestSchemaURL,
		Attributes: map[string]any{"email": email},
		ID:         userID,
	}, pool.Statements())
}

// issueRegistrationChallenge creates an attempt and issues a provisional
// registration challenge, returning the ceremony handles and creation options.
func issueRegistrationChallenge(t *testing.T, svc service.AuthAttemptService, projectID string) (attemptID string, registration *domain.AuthChallengePasskeyRegistration, options []byte) {
	t.Helper()
	attempt, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{ProjectID: projectID})
	require.NoError(t, err)

	issued, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attempt.ID,
		Challenge: service.PasskeyRegistrationChallenge{
			Username:  "alice@example.com",
			RPID:      passkeyRPID,
			RPOrigins: passkeyTestOrigins(t),
		},
	})
	require.NoError(t, err)

	check, ok := issued.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	require.True(t, ok)
	registration, ok = check.(*domain.AuthChallengePasskeyRegistration)
	require.True(t, ok)
	require.True(t, registration.Provisional)
	require.NotEmpty(t, registration.UserID)

	options, err = domain.BuildPasskeyCreationOptions(registration)
	require.NoError(t, err)
	return attempt.ID, registration, options
}

func listPasskeysForUser(t *testing.T, projectID, userID string) []*domain.UserPasskey {
	t.Helper()
	pool := integrationPoolOrFail(t)
	result, err := pool.Statements().ListUserPasskeys(t.Context(), &database.ListOptions[domain.UserPasskeyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		),
	})
	require.NoError(t, err)
	return result.Items
}

func TestAuthAttemptService_PasskeyRegistration_integration(t *testing.T) {
	svc := newAuthAttemptServiceForIntegration(integrationPoolOrFail(t))

	t.Run("provisional_signup_lands_user_credential_and_factors", func(t *testing.T) {
		projectID := "p-reg-signup-" + uniqueIntegrationSuffix(t)
		ensureProject(t, projectID)
		ensureUserSchema(t, projectID)
		attemptID, registration, options := issueRegistrationChallenge(t, svc, projectID)

		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   projectID,
			AttemptID:   attemptID,
			ChallengeID: registration.GetID(),
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				Name:                "Work laptop",
				CreateUser: func(userID string) []service.UserAction { return []service.UserAction{newRegistrationCreateUserAction(t, projectID, userID, "alice@example.com")} },
			},
		})
		require.NoError(t, err)

		// The credential row exists (its user FK proves the user row landed too).
		passkeys := listPasskeysForUser(t, projectID, registration.UserID)
		require.Len(t, passkeys, 1)
		assert.Equal(t, "Work laptop", passkeys[0].Name)

		// Round-trip: the stored checks decode into a verified user factor and
		// a verified registration factor; the challenge is consumed.
		attempt, err := svc.GetByID(t.Context(), projectID, attemptID)
		require.NoError(t, err)
		userFactor, ok := attempt.FactorByType(domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, registration.UserID, userFactor.(*domain.AuthFactorUser).UserID)
		regFactor, ok := attempt.FactorByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		decoded := regFactor.(*domain.AuthFactorPasskeyRegistration)
		assert.Equal(t, registration.UserID, decoded.UserID)
		assert.Equal(t, passkeys[0].CredentialID, decoded.CredentialID)
		assert.False(t, decoded.GetLastVerifiedAt().IsZero())
		_, stillChallenged := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		assert.False(t, stillChallenged)
	})

	t.Run("user_already_exists_rolls_back_everything", func(t *testing.T) {
		projectID := "p-reg-conflict-" + uniqueIntegrationSuffix(t)
		ensureProject(t, projectID)
		ensureUserSchema(t, projectID)

		// A user with the same unique email already exists.
		existing := newRegistrationCreateUserAction(t, projectID, "", "taken@example.com")
		require.NoError(t, existing.Prepare(t.Context()))
		require.NoError(t, existing.Apply(t.Context(), integrationPoolOrFail(t).Statements()))

		attemptID, registration, options := issueRegistrationChallenge(t, svc, projectID)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   projectID,
			AttemptID:   attemptID,
			ChallengeID: registration.GetID(),
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				CreateUser: func(userID string) []service.UserAction { return []service.UserAction{newRegistrationCreateUserAction(t, projectID, userID, "taken@example.com")} },
			},
		})
		require.ErrorIs(t, err, domain.ErrUserAlreadyExists())

		// Atomicity: no credential row, no factors, challenge still pending
		// with no failure bump (the attestation itself was fine).
		assert.Empty(t, listPasskeysForUser(t, projectID, registration.UserID))
		attempt, getErr := svc.GetByID(t.Context(), projectID, attemptID)
		require.NoError(t, getErr)
		_, hasUser := attempt.FactorByType(domain.AuthCheckTypeUser)
		assert.False(t, hasUser)
		_, hasRegistration := attempt.FactorByType(domain.AuthCheckTypePasskeyRegistration)
		assert.False(t, hasRegistration)
		ch, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		assert.Zero(t, ch.GetFailureCount())
	})

	t.Run("passkey_signup_session_carries_user_and_passkey_factors", func(t *testing.T) {
		projectID := "p-reg-exchange-" + uniqueIntegrationSuffix(t)
		ensureProject(t, projectID)
		ensureUserSchema(t, projectID)
		sessions, _ := newSessionServiceForIntegration(t)

		attemptID, registration, options := issueRegistrationChallenge(t, svc, projectID)
		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   projectID,
			AttemptID:   attemptID,
			ChallengeID: registration.GetID(),
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				CreateUser:          []service.UserAction{newRegistrationCreateUserAction(t, projectID, registration.UserID, "signup@example.com")},
			},
		})
		require.NoError(t, err)

		handedOff, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: projectID, AttemptID: attemptID})
		require.NoError(t, err)
		exchanged, err := sessions.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: handedOff.HandoffToken.Plain(),
		})
		require.NoError(t, err)

		stored, err := sessions.Get(t.Context(), service.GetSessionInput{
			ProjectID: projectID,
			SessionID: exchanged.ID,
		})
		require.NoError(t, err)
		require.NotNil(t, stored.UserID, "the sign-up session must be bound to the created user")
		assert.Equal(t, registration.UserID, *stored.UserID)
		factors := sessionFactorsByType(stored)
		require.Contains(t, factors, domain.AuthCheckTypeUser)
		require.Contains(t, factors, domain.AuthCheckTypePasskey,
			"a completed enrollment must merge into the session as a passkey factor")
		passkeyFactor, ok := factors[domain.AuthCheckTypePasskey].(*domain.AuthFactorPasskey)
		require.True(t, ok)
		assert.Equal(t, registration.UserID, passkeyFactor.UserID)
		assert.NotEmpty(t, passkeyFactor.CredentialID)
		assert.False(t, passkeyFactor.GetLastVerifiedAt().IsZero())
	})

	t.Run("password_signup_session_carries_user_and_password_factors", func(t *testing.T) {
		projectID := "p-reg-pw-exchange-" + uniqueIntegrationSuffix(t)
		ensureProject(t, projectID)
		ensureUserSchema(t, projectID)
		pool := integrationPoolOrFail(t)
		sessions, _ := newSessionServiceForIntegration(t)

		ctrl := gomock.NewController(t)
		hasher := cryptomock.NewMockHasher(ctrl)
		hasher.EXPECT().Hash(gomock.Any()).Return("hashed:pw", nil)
		handler := service.NewFlowCreateUserHandler(
			hasher,
			service.NewUserService(pool, pool.Statements(), hasher),
			pool.Statements(),
			pool,
		)

		attempt, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{ProjectID: projectID})
		require.NoError(t, err)

		out, err := handler.Handle(t.Context(), domain.FlowOnSuccessInput{
			ProjectID:     projectID,
			UserSchemaURL: registrationTestSchemaURL,
			State: &domain.FlowState{
				ProjectID:     projectID,
				AuthAttemptID: attempt.ID,
				FlowProgress: domain.FlowProgress{
					CollectedData: domain.CollectedFlowData{
						UserData:    map[string]any{"email": "pw-signup@example.com"},
						AuthMethods: domain.CollectedAuthMethodData{Password: "s3cret"},
					},
				},
			},
		})
		require.NoError(t, err)
		require.NotEmpty(t, out.UserID)

		handedOff, err := svc.Handoff(t.Context(), service.HandoffInput{ProjectID: projectID, AttemptID: attempt.ID})
		require.NoError(t, err)
		exchanged, err := sessions.Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    projectID,
			HandoffToken: handedOff.HandoffToken.Plain(),
		})
		require.NoError(t, err)

		stored, err := sessions.Get(t.Context(), service.GetSessionInput{
			ProjectID: projectID,
			SessionID: exchanged.ID,
		})
		require.NoError(t, err)
		require.NotNil(t, stored.UserID)
		assert.Equal(t, out.UserID, *stored.UserID)
		factors := sessionFactorsByType(stored)
		require.Contains(t, factors, domain.AuthCheckTypeUser)
		require.Contains(t, factors, domain.AuthCheckTypePassword,
			"a password sign-up must record a real password factor on the session")
	})

	t.Run("bad_attestation_bumps_failure_count_then_retry_succeeds", func(t *testing.T) {
		projectID := "p-reg-retry-" + uniqueIntegrationSuffix(t)
		ensureProject(t, projectID)
		ensureUserSchema(t, projectID)
		attemptID, registration, options := issueRegistrationChallenge(t, svc, projectID)

		_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   projectID,
			AttemptID:   attemptID,
			ChallengeID: registration.GetID(),
			Proof:       service.PasskeyRegistrationProof{AttestationResponse: []byte(`{"not":"valid-webauthn"}`)},
		})
		require.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))

		attempt, err := svc.GetByID(t.Context(), projectID, attemptID)
		require.NoError(t, err)
		ch, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		assert.Equal(t, uint16(1), ch.GetFailureCount())

		_, err = svc.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   projectID,
			AttemptID:   attemptID,
			ChallengeID: registration.GetID(),
			Proof: service.PasskeyRegistrationProof{
				AttestationResponse: attestRegistration(t, options),
				CreateUser: func(userID string) []service.UserAction { return []service.UserAction{newRegistrationCreateUserAction(t, projectID, userID, "retry@example.com")} },
			},
		})
		require.NoError(t, err)
		assert.Len(t, listPasskeysForUser(t, projectID, registration.UserID), 1)
	})
}
