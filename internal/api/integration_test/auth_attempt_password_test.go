//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// The auth_attempts REST surface is the API a non-browser client authenticates
// with: no rendered step to read a field name from, so the identifier proof
// names the attribute itself. This drives the whole sequence — attempt,
// identifier, password, handoff — the way such a client does, which the flow
// tests cannot cover because the flow supplies the attribute from its own step
// definition.
func TestAuthAttemptPasswordLogin(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	const (
		userID    = "user_attempt01"
		userEmail = "attempt@example.com"
		userPass  = "correct-horse-battery-staple"
	)

	emailAttr, err := domain.NewCreateAttribute("email", userEmail, domain.AttributeUniquenessProject)
	require.NoError(t, err)

	users := harness.EnsureUserFixture(t)
	require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
		ID:                      userID,
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))

	encodedHash, err := harness.EnsureHasher(t).Hash(userPass)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).SetPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   project.ID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}))

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	attemptResp, err := client.CreateAuthAttempt(t.Context(), &api.CreateAuthAttemptRequest{
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	require.IsType(t, &api.AuthAttemptResponse{}, attemptResp, helpers.MustMarshal(t, attemptResp))
	attemptID := attemptResp.(*api.AuthAttemptResponse).AttemptID

	// The user is identified by `email` here because that is what this project
	// registered unique — another project identifies by `username`, and the
	// proof is what says which.
	userFactor := verifyAttemptProof(t, client, attemptID, api.FactorMethodIdentifier,
		identifierProof(userEmail, "email"))
	require.Contains(t, completedMethods(userFactor), api.FactorMethodIdentifier,
		"identifier proof did not resolve the user: %s", helpers.MustMarshal(t, userFactor))

	passwordFactor := verifyAttemptProof(t, client, attemptID, api.FactorMethodPassword,
		&api.VerifyChallengeRequest{
			OneOf: api.NewPasswordProofVerifyChallengeRequestSum(api.PasswordProof{Password: userPass}),
		})
	require.Contains(t, completedMethods(passwordFactor), api.FactorMethodPassword,
		"password proof was not recorded: %s", helpers.MustMarshal(t, passwordFactor))

	handoffResp, err := client.CreateHandoff(t.Context(), api.CreateHandoffParams{AttemptID: attemptID})
	require.NoError(t, err)
	require.IsType(t, &api.HandoffResponse{}, handoffResp, helpers.MustMarshal(t, handoffResp))
	require.NotEmpty(t, handoffResp.(*api.HandoffResponse).HandoffToken)
}

// An identifier proof naming an attribute the value does not belong to must not
// resolve the user: `username` holds no such value, even though `email` does.
func TestAuthAttemptPasswordLogin_WrongAttributeDoesNotResolve(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	const userEmail = "attempt-wrong-attr@example.com"
	emailAttr, err := domain.NewCreateAttribute("email", userEmail, domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
		ID:                      "user_attempt02",
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	attemptResp, err := client.CreateAuthAttempt(t.Context(), &api.CreateAuthAttemptRequest{
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	attemptID := attemptResp.(*api.AuthAttemptResponse).AttemptID

	challengeResp, err := client.IssueChallenge(t.Context(),
		&api.IssueChallengeRequest{Method: api.FactorMethodIdentifier},
		api.IssueChallengeParams{AttemptID: attemptID})
	require.NoError(t, err)
	challenge := challengeResp.(*api.ChallengeResponse)

	verifyResp, err := client.VerifyChallengeProof(t.Context(),
		identifierProof(userEmail, "username"),
		api.VerifyChallengeProofParams{AttemptID: attemptID, ChallengeID: challenge.ChallengeID})
	require.NoError(t, err)
	_, resolved := verifyResp.(*api.AuthAttemptResponse)
	require.False(t, resolved,
		"a value under another attribute must not identify the user: %s", helpers.MustMarshal(t, verifyResp))
}

func verifyAttemptProof(
	t *testing.T,
	client *helpers.ApiClient,
	attemptID api.AttemptID,
	method api.FactorMethod,
	proof *api.VerifyChallengeRequest,
) *api.AuthAttemptResponse {
	t.Helper()

	challengeResp, err := client.IssueChallenge(t.Context(),
		&api.IssueChallengeRequest{Method: method},
		api.IssueChallengeParams{AttemptID: attemptID})
	require.NoError(t, err)
	require.IsType(t, &api.ChallengeResponse{}, challengeResp, helpers.MustMarshal(t, challengeResp))

	verifyResp, err := client.VerifyChallengeProof(t.Context(), proof, api.VerifyChallengeProofParams{
		AttemptID:   attemptID,
		ChallengeID: challengeResp.(*api.ChallengeResponse).ChallengeID,
	})
	require.NoError(t, err)
	require.IsType(t, &api.AuthAttemptResponse{}, verifyResp, "verify %s: %s", method, helpers.MustMarshal(t, verifyResp))
	return verifyResp.(*api.AuthAttemptResponse)
}

// The proof is a oneOf, so build it once here rather than at each call site.
func identifierProof(loginName, attributeName string) *api.VerifyChallengeRequest {
	return &api.VerifyChallengeRequest{
		OneOf: api.NewIdentifierProofVerifyChallengeRequestSum(api.IdentifierProof{
			LoginName:     loginName,
			AttributeName: attributeName,
		}),
	}
}

func completedMethods(attempt *api.AuthAttemptResponse) []api.FactorMethod {
	methods := make([]api.FactorMethod, 0, len(attempt.CompletedFactors))
	for _, factor := range attempt.CompletedFactors {
		methods = append(methods, factor.Method)
	}
	return methods
}
