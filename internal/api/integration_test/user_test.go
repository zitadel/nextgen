package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestSetUserPassword(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)

		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})
		require.NoError(t, err)

		// TODO: user schema and flow definition should be created according to https://github.com/zitadel/nextgen/pull/183

		user := harness.TestData.Generator.GenerateUser(t)

		// TODO: need to be able to create users before adding a password for them https://github.com/zitadel/nextgen/pull/170
		//user, err = harness.EnsureUserService(t).Create(ctx, service.CreateUserInput{
		//	ProjectID: project.ID,
		//	TeamID:    team.ID,
		//	User:      user,
		//})
		//require.NoError(t, err)
		userID := user["id"].(string)
		userEmail := user["email"].(string)

		client := harness.EnsureAPIClient(t, project.ID)

		const password = "fake-password"
		request := &api.SetUserPasswordRequest{
			Password: password,
		}
		params := api.SetUserPasswordParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.NewOptTeamID(api.TeamID(team.ID)),
			UserID:    api.UserID(userID),
		}

		resp, err := client.SetUserPassword(t.Context(), request, params)
		require.NoError(t, err)

		require.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

		authAttempts := harness.EnsureAuthAttemptService(t)
		attempt, err := authAttempts.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      project.ID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword},
		})
		require.NoError(t, err)

		attempt, err = authAttempts.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: project.ID,
			AttemptID: attempt.ID,
			Challenge: service.UserChallenge{},
		})
		require.NoError(t, err)
		userChallenge, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
		require.True(t, ok)

		attempt, err = authAttempts.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   project.ID,
			AttemptID:   attempt.ID,
			ChallengeID: userChallenge.GetID(),
			Proof: service.UserProof{
				AttributeName: "email",
				LoginName:     userEmail,
			},
		})
		require.NoError(t, err)

		attempt, err = authAttempts.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: project.ID,
			AttemptID: attempt.ID,
			Challenge: service.PasswordChallenge{},
		})
		require.NoError(t, err)
		passwordChallenge, ok := attempt.ChallengeByType(domain.AuthCheckTypePassword)
		require.True(t, ok)

		attempt, err = authAttempts.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   project.ID,
			AttemptID:   attempt.ID,
			ChallengeID: passwordChallenge.GetID(),
			Proof:       service.PasswordProof{Password: password},
		})
		require.NoError(t, err)
		assert.True(t, attempt.IsCompleted())

		attempt, err = authAttempts.Handoff(t.Context(), service.HandoffInput{
			ProjectID: project.ID,
			AttemptID: attempt.ID,
		})
		require.NoError(t, err)
		require.NotNil(t, attempt.HandoffToken)

		session, err := harness.EnsureSessionService(t).Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    project.ID,
			HandoffToken: attempt.HandoffToken.Plain(),
		})
		require.NoError(t, err)
		require.NotNil(t, session.UserID)
		assert.Equal(t, userID, *session.UserID)
		assert.Len(t, session.Factors, 2)

	})

	t.Run("error", func(t *testing.T) {
		t.Run("user not found", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
			require.NoError(t, err)

			team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
				ProjectID: project.ID,
			})
			require.NoError(t, err)

			client := harness.EnsureAPIClient(t, project.ID)

			request := &api.SetUserPasswordRequest{
				Password: "fake-password",
			}
			params := api.SetUserPasswordParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.NewOptTeamID(api.TeamID(team.ID)),
				UserID:    api.UserID("user_does-not-exist"),
			}

			resp, err := client.SetUserPassword(t.Context(), request, params)
			assert.NoError(t, err)

			assert.IsType(t, &api.SetUserPasswordNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}
