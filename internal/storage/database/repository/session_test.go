package repository_test

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func ensureProjectTeamSchemaUser(t *testing.T, client database.QueryExecutor, pid, tid, schemaURL, userID string) {
	t.Helper()
	ctx := t.Context()
	ensureProject(t, client, pid)
	_, err := client.Exec(ctx, `INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, pid, tid)
	require.NoError(t, err)
	_, err = client.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1,$2,$3::json) ON CONFLICT DO NOTHING`,
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)
	_, err = client.Exec(ctx,
		`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, team_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
		pid, schemaURL, userID, tid,
	)
	require.NoError(t, err)
}

func newTestSession(projectID, sessionID, token string) *domain.Session {
	expiresAt := time.Now().Add(10 * time.Minute).UTC()
	return &domain.Session{
		ProjectID: projectID,
		ID:        sessionID,
		Token:     token,
		ExpiresAt: expiresAt,
		UserAgent: &domain.UserAgent{
			ID:   "ua-" + sessionID,
			Info: map[string]any{"browser": "safari", "platform": "macos"},
		},
	}
}

func persistedCheckID(projectID, attemptID string, typ domain.AuthCheckType) string {
	return projectID + ":" + attemptID + ":" + strconv.Itoa(int(typ))
}

func bindCheckCredentialColumn(t *testing.T, projectID, checkID, column string, credentialID int64) {
	t.Helper()
	_, err := pool.Exec(t.Context(),
		fmt.Sprintf(`UPDATE zitadel_nextgen.checks SET %s = $1 WHERE project_id = $2 AND id = $3`, column),
		credentialID, projectID, checkID,
	)
	require.NoError(t, err)
}

func handoffAndMergeSession(
	t *testing.T,
	sessRepo domain.SessionRepository,
	attemptRepo domain.AuthAttemptRepository,
	projectID, sessionID, attemptID, handoffToken string,
) *domain.Session {
	t.Helper()
	attempt := &domain.AuthAttempt{
		ProjectID:    projectID,
		ID:           attemptID,
		HandoffToken: &handoffToken,
	}
	require.NoError(t, attemptRepo.Handoff(t.Context(), pool, attempt))
	merged, err := sessRepo.MergeAttempt(t.Context(), projectID, sessionID, handoffToken)
	require.NoError(t, err)
	return merged
}

func sessionRepo(t *testing.T, tx database.QueryExecutor) domain.SessionRepository {
	t.Helper()
	var beginner database.Beginner = pool
	if b, ok := tx.(database.Beginner); ok {
		beginner = b
	}
	return repository.NewSessionRepositoryForTest(tx, beginner, repository.NewAuthAttemptRepository(pool))
}

func TestSession_CreateAndGet(t *testing.T) {
	t.Run("create stores and get by id returns session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		session := newTestSession("project-create", "session-create", "stok-create")
		ensureProject(t, tx, session.ProjectID)

		require.NoError(t, repo.Create(t.Context(), session))
		assert.False(t, session.CreatedAt.IsZero())

		stored, err := repo.GetByID(t.Context(), session.ProjectID, session.ID)
		require.NoError(t, err)
		assert.Equal(t, session.ID, stored.ID)
		assert.Equal(t, session.Token, stored.Token)
		require.NotNil(t, stored.UserAgent)
		assert.Equal(t, "safari", stored.UserAgent.Info["browser"])
	})

	t.Run("get by token resolves row", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		session := newTestSession("project-by-token", "session-by-token", "stok-by-token")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), session))

		stored, err := repo.GetByToken(t.Context(), session.ProjectID, session.Token)
		require.NoError(t, err)
		assert.Equal(t, session.ID, stored.ID)
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		repo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
		_, err := repo.GetByID(t.Context(), "missing-project", "missing-session")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})

	t.Run("duplicate token in same project fails", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		ensureProject(t, tx, "project-dup-token")
		first := newTestSession("project-dup-token", "session-one", "stok-dup")
		second := newTestSession("project-dup-token", "session-two", "stok-dup")
		require.NoError(t, repo.Create(t.Context(), first))

		_, spRollback := savepointForRollback(t, tx)
		err := repo.Create(t.Context(), second)
		spRollback()
		require.Error(t, err)
		var uniqueErr *database.UniqueError
		assert.ErrorAs(t, err, &uniqueErr)
	})
}

func TestSession_Delete(t *testing.T) {
	t.Run("delete existing session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		session := newTestSession("project-delete", "session-delete", "stok-delete")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), session))

		require.NoError(t, repo.Delete(t.Context(), session.ProjectID, session.ID))

		_, err := repo.GetByID(t.Context(), session.ProjectID, session.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})

	t.Run("delete missing is no-op", func(t *testing.T) {
		repo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
		err := repo.Delete(t.Context(), "missing-project", "missing-session")
		require.NoError(t, err)
	})
}

func TestSession_MergeAttempt(t *testing.T) {
	sessRepo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
	attemptRepo := repository.NewAuthAttemptRepository(pool)

	t.Run("merges handed-off password check into session", func(t *testing.T) {
		projectID := "p-merge"
		ensureProject(t, pool, projectID)

		session := newTestSession(projectID, "sess-merge", "stok-merge")
		require.NoError(t, sessRepo.Create(t.Context(), session))

		check := &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}}
		attempt := &domain.AuthAttempt{
			ProjectID:      projectID,
			ID:             "attempt-merge",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthChecker{check},
		}
		require.NoError(t, attemptRepo.Create(t.Context(), pool, attempt))
		require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attempt.ID, check))

		token := "handoff-merge"
		attempt.HandoffToken = &token
		require.NoError(t, attemptRepo.Handoff(t.Context(), pool, attempt))

		merged, err := sessRepo.MergeAttempt(t.Context(), projectID, session.ID, token)
		require.NoError(t, err)
		require.NotEmpty(t, merged.Token)
		assert.NotEqual(t, session.Token, merged.Token)
		require.Len(t, merged.Factors, 1)
		assert.Equal(t, domain.AuthCheckTypePassword, merged.Factors[0].Type)

		storedAttempt, err := attemptRepo.GetByID(t.Context(), pool, projectID, attempt.ID)
		require.NoError(t, err)
		assert.Empty(t, storedAttempt.ID)
	})

	t.Run("merge resets credential failed_attempts when check is bound to user password", func(t *testing.T) {
		const (
			projectID = "p-merge-cred"
			teamID    = "team-merge-cred"
			schemaURL = "https://schemas.test/merge-cred.json"
			userID    = "user-merge-cred"
		)
		ensureProjectTeamSchemaUser(t, pool, projectID, teamID, schemaURL, userID)

		pwRepo := repository.NewUserPasswordRepository()
		require.NoError(t, pwRepo.Create(t.Context(), pool, &domain.CreateUserPassword{
			ProjectID:      projectID,
			UserID:         userID,
			EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$fake",
			ChangeRequired: false,
		}))
		password, err := pwRepo.Get(t.Context(), pool, database.WithCondition(pwRepo.UniqueCondition(projectID, userID)))
		require.NoError(t, err)

		_, err = pool.Exec(t.Context(),
			`UPDATE zitadel_nextgen.user_passwords SET failed_attempts = 5 WHERE id = $1`,
			password.ID,
		)
		require.NoError(t, err)

		session := newTestSession(projectID, "sess-merge-cred", "stok-merge-cred")
		require.NoError(t, sessRepo.Create(t.Context(), session))

		check := &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}}
		attempt := &domain.AuthAttempt{
			ProjectID:      projectID,
			ID:             "attempt-merge-cred",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthChecker{check},
		}
		require.NoError(t, attemptRepo.Create(t.Context(), pool, attempt))
		require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attempt.ID, check))

		checkID := projectID + ":" + attempt.ID + ":" + strconv.Itoa(int(domain.AuthCheckTypePassword))
		_, err = pool.Exec(t.Context(),
			`UPDATE zitadel_nextgen.checks SET user_password_id = $1 WHERE project_id = $2 AND id = $3`,
			password.ID, projectID, checkID,
		)
		require.NoError(t, err)

		token := "handoff-merge-cred"
		attempt.HandoffToken = &token
		require.NoError(t, attemptRepo.Handoff(t.Context(), pool, attempt))

		_, err = sessRepo.MergeAttempt(t.Context(), projectID, session.ID, token)
		require.NoError(t, err)

		after, err := pwRepo.Get(t.Context(), pool, database.WithCondition(pwRepo.PrimaryKeyCondition(password.ID)))
		require.NoError(t, err)
		assert.Equal(t, int16(0), after.FailedAttempts)
	})
}

func TestSession_MergeAndGet_checkTypes(t *testing.T) {
	sessRepo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
	attemptRepo := repository.NewAuthAttemptRepository(pool)

	type checkCase struct {
		name           string
		typ            domain.AuthCheckType
		checker        domain.AuthChecker
		markSucceeded  bool
		wantUserID     string
		assertFactor   func(t *testing.T, factor *domain.SessionFactor)
	}

	cases := []checkCase{
		{
			name: "user",
			typ:  domain.AuthCheckTypeUser,
			checker: &domain.UserAuthCheck{
				AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
				Factor:    &domain.UserFactor{UserID: "user-sess-types"},
			},
			wantUserID: "user-sess-types",
			assertFactor: func(t *testing.T, factor *domain.SessionFactor) {
				t.Helper()
				payload, ok := factor.Factor.(*domain.UserFactor)
				require.True(t, ok)
				assert.Equal(t, "user-sess-types", payload.UserID)
			},
		},
		{
			name: "password",
			typ:  domain.AuthCheckTypePassword,
			checker: &domain.PasswordAuthCheck{
				AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword},
			},
			markSucceeded: true,
		},
		{
			name: "passkey",
			typ:  domain.AuthCheckTypePasskey,
			checker: &domain.PasskeyAuthCheck{
				AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePasskey},
				Challenge: &domain.PasskeyAuthCheckChallenge{Challenge: "pk-challenge"},
				Factor:    &domain.PasskeyAuthCheckFactor{UserVerified: true},
			},
			markSucceeded: true,
			assertFactor: func(t *testing.T, factor *domain.SessionFactor) {
				t.Helper()
				payload, ok := factor.Factor.(*domain.PasskeyAuthCheckFactor)
				require.True(t, ok)
				assert.True(t, payload.UserVerified)
			},
		},
		{
			name: "identity_provider",
			typ:  domain.AuthCheckTypeIdentityProvider,
			checker: &domain.IdentityProviderAuthCheck{
				AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeIdentityProvider},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			projectID := "p-merge-get-" + tc.name
			attemptID := "attempt-" + tc.name
			sessionID := "sess-" + tc.name
			handoffToken := "handoff-" + tc.name

			if tc.wantUserID != "" {
				ensureProjectTeamSchemaUser(t, pool, projectID, "team-"+tc.name, "https://schemas.test/"+tc.name+".json", tc.wantUserID)
			} else {
				ensureProject(t, pool, projectID)
			}
			session := newTestSession(projectID, sessionID, "stok-"+tc.name)
			require.NoError(t, sessRepo.Create(t.Context(), session))

			attempt := &domain.AuthAttempt{
				ProjectID:      projectID,
				ID:             attemptID,
				RequiredChecks: []domain.AuthCheckType{tc.typ},
				Checks:         []domain.AuthChecker{tc.checker},
			}
			require.NoError(t, attemptRepo.Create(t.Context(), pool, attempt))
			if tc.markSucceeded {
				require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attemptID, tc.checker))
			}

			merged := handoffAndMergeSession(t, sessRepo, attemptRepo, projectID, sessionID, attemptID, handoffToken)
			require.Len(t, merged.Factors, 1)
			assert.Equal(t, tc.typ, merged.Factors[0].Type)
			if tc.assertFactor != nil {
				tc.assertFactor(t, merged.Factors[0])
			}
			if tc.wantUserID != "" {
				require.NotNil(t, merged.UserID)
				assert.Equal(t, tc.wantUserID, *merged.UserID)
			}

			stored, err := sessRepo.GetByID(t.Context(), projectID, sessionID)
			require.NoError(t, err)
			require.Len(t, stored.Factors, 1)
			assert.Equal(t, tc.typ, stored.Factors[0].Type)
			assert.NotEqual(t, session.Token, stored.Token)
			if tc.wantUserID != "" {
				require.NotNil(t, stored.UserID)
				assert.Equal(t, tc.wantUserID, *stored.UserID)
			}
			if tc.assertFactor != nil {
				tc.assertFactor(t, stored.Factors[0])
			}
		})
	}
}

func TestSession_MergeAndGet_allCheckTypesTogether(t *testing.T) {
	sessRepo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
	attemptRepo := repository.NewAuthAttemptRepository(pool)

	const (
		projectID  = "p-merge-get-all"
		attemptID  = "attempt-all"
		sessionID  = "sess-all"
		userID     = "user-all-types"
		handoffTok = "handoff-all-types"
	)

	ensureProjectTeamSchemaUser(t, pool, projectID, "team-all", "https://schemas.test/all.json", userID)
	session := newTestSession(projectID, sessionID, "stok-all")
	require.NoError(t, sessRepo.Create(t.Context(), session))

	userCheck := &domain.UserAuthCheck{
		AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeUser},
		Factor:    &domain.UserFactor{UserID: userID},
	}
	passwordCheck := &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}}
	passkeyCheck := &domain.PasskeyAuthCheck{
		AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePasskey},
		Challenge: &domain.PasskeyAuthCheckChallenge{Challenge: "all-challenge"},
		Factor:    &domain.PasskeyAuthCheckFactor{UserVerified: true},
	}
	idpCheck := &domain.IdentityProviderAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypeIdentityProvider}}

	attempt := &domain.AuthAttempt{
		ProjectID: projectID,
		ID:        attemptID,
		RequiredChecks: []domain.AuthCheckType{
			domain.AuthCheckTypeUser,
			domain.AuthCheckTypePassword,
			domain.AuthCheckTypePasskey,
			domain.AuthCheckTypeIdentityProvider,
		},
		Checks: []domain.AuthChecker{userCheck, passwordCheck, passkeyCheck, idpCheck},
	}
	require.NoError(t, attemptRepo.Create(t.Context(), pool, attempt))
	require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attemptID, passwordCheck))
	require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attemptID, passkeyCheck))

	merged := handoffAndMergeSession(t, sessRepo, attemptRepo, projectID, sessionID, attemptID, handoffTok)
	require.Len(t, merged.Factors, 4)
	assert.ElementsMatch(t, []domain.AuthCheckType{
		domain.AuthCheckTypeUser,
		domain.AuthCheckTypePassword,
		domain.AuthCheckTypePasskey,
		domain.AuthCheckTypeIdentityProvider,
	}, factorTypes(merged.Factors))
	require.NotNil(t, merged.UserID)
	assert.Equal(t, userID, *merged.UserID)

	stored, err := sessRepo.GetByID(t.Context(), projectID, sessionID)
	require.NoError(t, err)
	require.Len(t, stored.Factors, 4)
	assert.ElementsMatch(t, factorTypes(merged.Factors), factorTypes(stored.Factors))
	require.NotNil(t, stored.UserID)
	assert.Equal(t, userID, *stored.UserID)

	userFactor := stored.GetFactor(domain.AuthCheckTypeUser)
	require.NotNil(t, userFactor)
	payload, ok := userFactor.Factor.(*domain.UserFactor)
	require.True(t, ok)
	assert.Equal(t, userID, payload.UserID)
}

func factorTypes(factors []*domain.SessionFactor) []domain.AuthCheckType {
	types := make([]domain.AuthCheckType, len(factors))
	for i, f := range factors {
		types[i] = f.Type
	}
	return types
}

func TestSession_MergeAndGet_credentialBindings(t *testing.T) {
	sessRepo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
	attemptRepo := repository.NewAuthAttemptRepository(pool)

	const (
		projectID = "p-merge-cred-types"
		teamID    = "team-merge-cred-types"
		schemaURL = "https://schemas.test/merge-cred-types.json"
		userID    = "user-cred-types"
	)

	ensureProjectTeamSchemaUser(t, pool, projectID, teamID, schemaURL, userID)

	pwRepo := repository.NewUserPasswordRepository()
	require.NoError(t, pwRepo.Create(t.Context(), pool, &domain.CreateUserPassword{
		ProjectID: projectID, UserID: userID, EncodedHash: "hash", ChangeRequired: false,
	}))
	password, err := pwRepo.Get(t.Context(), pool, database.WithCondition(pwRepo.UniqueCondition(projectID, userID)))
	require.NoError(t, err)

	totpRepo := repository.NewUserTOTPRepository()
	require.NoError(t, totpRepo.Create(t.Context(), pool, &domain.CreateUserTOTP{
		ProjectID: projectID, UserID: userID, Secret: []byte{1, 2, 3},
	}))
	totp, err := totpRepo.Get(t.Context(), pool, database.WithCondition(totpRepo.UniqueCondition(projectID, userID)))
	require.NoError(t, err)

	pkRepo := repository.NewUserPasskeyRepository()
	require.NoError(t, pkRepo.Create(t.Context(), pool, &domain.CreateUserPasskey{
		ProjectID: projectID, UserID: userID, CredentialID: "cred-bind",
		PublicKey: []byte{9}, AAGUID: []byte{1}, AttestationType: gu.Ptr("none"),
		Transports: []string{"internal"}, SignCount: 1, Name: "bind",
	}))
	passkey, err := pkRepo.Get(t.Context(), pool, database.WithCondition(pkRepo.UniqueCondition(projectID, userID, "cred-bind")))
	require.NoError(t, err)

	rcRepo := repository.NewUserRecoveryCodesRepository()
	require.NoError(t, rcRepo.Create(t.Context(), pool, &domain.CreateRecoveryCodes{
		ProjectID: projectID, UserID: userID, RecoveryCodes: []string{"code-one"},
	}))
	recovery, err := rcRepo.Get(t.Context(), pool, database.WithCondition(rcRepo.UniqueCondition(projectID, userID)))
	require.NoError(t, err)

	type credCase struct {
		name       string
		typ        domain.AuthCheckType
		checker    domain.AuthChecker
		column     string
		credential int64
	}

	cases := []credCase{
		{
			name:       "user_password",
			typ:        domain.AuthCheckTypePassword,
			checker:    &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}},
			column:     "user_password_id",
			credential: password.ID,
		},
		{
			name:       "user_totp",
			typ:        domain.AuthCheckTypePassword,
			checker:    &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}},
			column:     "user_totp_id",
			credential: totp.ID,
		},
		{
			name:       "user_passkey",
			typ:        domain.AuthCheckTypePasskey,
			checker: &domain.PasskeyAuthCheck{
				AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePasskey},
				Factor:    &domain.PasskeyAuthCheckFactor{UserVerified: true},
			},
			column:     "user_passkey_id",
			credential: passkey.ID,
		},
		{
			name:       "user_recovery_codes",
			typ:        domain.AuthCheckTypePassword,
			checker:    &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}},
			column:     "user_recovery_codes_id",
			credential: recovery.ID,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			attemptID := "attempt-cred-" + tc.name
			sessionID := "sess-cred-" + tc.name
			handoffToken := "handoff-cred-" + tc.name

			session := newTestSession(projectID, sessionID, "stok-cred-"+tc.name)
			require.NoError(t, sessRepo.Create(t.Context(), session))

			attempt := &domain.AuthAttempt{
				ProjectID:      projectID,
				ID:             attemptID,
				RequiredChecks: []domain.AuthCheckType{tc.typ},
				Checks:         []domain.AuthChecker{tc.checker},
			}
			require.NoError(t, attemptRepo.Create(t.Context(), pool, attempt))
			require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attemptID, tc.checker))

			checkID := persistedCheckID(projectID, attemptID, tc.typ)
			bindCheckCredentialColumn(t, projectID, checkID, tc.column, tc.credential)

			merged := handoffAndMergeSession(t, sessRepo, attemptRepo, projectID, sessionID, attemptID, handoffToken)
			require.Len(t, merged.Factors, 1)
			assert.Equal(t, tc.typ, merged.Factors[0].Type)

			stored, err := sessRepo.GetByID(t.Context(), projectID, sessionID)
			require.NoError(t, err)
			require.Len(t, stored.Factors, 1)
			assert.Equal(t, tc.typ, stored.Factors[0].Type)
		})
	}
}
