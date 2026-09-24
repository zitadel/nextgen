//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// The auth-attempt REST surface is how a client that renders no login step
// signs a user in. Its identifier proof carries only the login name: the server
// resolves it against the designated identifier of each user schema in the
// project (ADR 058 §5), so these tests pin that resolution end to end — the
// flow tests cannot, because the flow names the property from its own step.

func TestAuthAttemptPasswordLogin(t *testing.T) {
	project, team := attemptProject(t)

	const (
		userID    = "user_attempt01"
		userEmail = "attempt@example.com"
		userPass  = "correct-horse-battery-staple"
	)
	createAttemptUser(t, project, team, defaultSchemaURL(), userID, map[string]string{"email": userEmail})
	setAttemptPassword(t, project, userID, userPass)

	client := attemptClient(t, project)
	attemptID := newAttempt(t, client, project)

	// The default schema designates `email`, so the bare value identifies them.
	identified := verifyAttemptProof(t, client, attemptID, api.FactorMethodIdentifier, identifierProof(userEmail))
	require.Contains(t, completedMethods(identified), api.FactorMethodIdentifier)
	require.Equal(t, userID, identifiedUser(t, identified), "identified the wrong user")

	passworded := verifyAttemptProof(t, client, attemptID, api.FactorMethodPassword,
		&api.VerifyChallengeRequest{
			OneOf: api.NewPasswordProofVerifyChallengeRequestSum(api.PasswordProof{Password: userPass}),
		})
	require.Contains(t, completedMethods(passworded), api.FactorMethodPassword)

	handoffResp, err := client.CreateHandoff(t.Context(), api.CreateHandoffParams{AttemptID: attemptID})
	require.NoError(t, err)
	require.IsType(t, &api.HandoffResponse{}, handoffResp, helpers.MustMarshal(t, handoffResp))
	require.NotEmpty(t, handoffResp.(*api.HandoffResponse).HandoffToken)
}

// A value held in a unique property the schema does not designate identifies
// nobody: uniqueness is data integrity, identification is a designation. This is
// the rule a caller-chosen property would break — a unique employee id or phone
// number becoming a login identifier the project never enabled.
func TestAuthAttemptIdentifier_UndesignatedPropertyDoesNotIdentify(t *testing.T) {
	project, team := attemptProject(t)
	createAttemptUser(t, project, team, defaultSchemaURL(), "user_attempt02", map[string]string{
		"email":      "undesignated@example.com",
		"employeeId": "E-1001",
	})

	client := attemptClient(t, project)

	requireProofRejected(t, client, newAttempt(t, client, project), identifierProof("E-1001"))
	// The same user is found by the property the schema does designate, so the
	// rejection above is the designation at work, not a broken endpoint.
	verifyAttemptProof(t, client, newAttempt(t, client, project), api.FactorMethodIdentifier,
		identifierProof("undesignated@example.com"))
}

// Two schemas designating different properties can each hold the same value
// for a different user — a race past the write-time check, or data from before
// it. Resolution never picks one by precedence; the proof is rejected.
func TestAuthAttemptIdentifier_AmbiguousAcrossSchemasIsRejected(t *testing.T) {
	project, team := attemptProject(t)
	adminSchemaURL := harness.CreateUserSchema(t, project, `{
		"title": "AttemptAdminUser",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://attempt-admin.example.com/schemas/admin-user.json",
		"kind": "user-schema",
		"type": "object",
		"x-identifier": "username",
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"username": {"type": "string", "x-unique": "project"}
		}
	}`)

	const shared = "shared@example.com"
	createAttemptUser(t, project, team, defaultSchemaURL(), "user_attempt03", map[string]string{"email": shared})
	createAttemptUser(t, project, team, adminSchemaURL, "user_attempt04", map[string]string{"username": shared})

	client := attemptClient(t, project)
	requireProofRejected(t, client, newAttempt(t, client, project), identifierProof(shared))
}

func attemptProject(t *testing.T) (*domain.Project, *domain.Team) {
	t.Helper()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	return project, team
}

func defaultSchemaURL() string {
	return apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
}

// createAttemptUser registers every attribute as project-unique, so a test can
// hold a value in a unique but undesignated property.
func createAttemptUser(t *testing.T, project *domain.Project, team *domain.Team, schemaURL, id string, attrs map[string]string) {
	t.Helper()
	created := make(domain.CreateAttributes, 0, len(attrs))
	for key, value := range attrs {
		attr, err := domain.NewCreateAttribute(domain.AttributeKey(key), value, domain.AttributeUniquenessProject)
		require.NoError(t, err)
		created = append(created, *attr)
	}
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               schemaURL,
		ID:                      id,
		InitialMembershipTeamID: &team.ID,
		Attributes:              created,
	}))
}

func setAttemptPassword(t *testing.T, project *domain.Project, userID, password string) {
	t.Helper()
	encodedHash, err := harness.EnsureHasher(t).Hash(password)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).SetPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   project.ID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}))
}

func attemptClient(t *testing.T, project *domain.Project) *helpers.ApiClient {
	t.Helper()
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	return client
}

func newAttempt(t *testing.T, client *helpers.ApiClient, project *domain.Project) api.AttemptID {
	t.Helper()
	resp, err := client.CreateAuthAttempt(t.Context(), &api.CreateAuthAttemptRequest{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.AuthAttemptResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.AuthAttemptResponse).AttemptID
}

func verifyAttemptProof(
	t *testing.T,
	client *helpers.ApiClient,
	attemptID api.AttemptID,
	method api.FactorMethod,
	proof *api.VerifyChallengeRequest,
) *api.AuthAttemptResponse {
	t.Helper()
	challengeID := issueAttemptChallenge(t, client, attemptID, method)
	verifyResp, err := client.VerifyChallengeProof(t.Context(), proof, api.VerifyChallengeProofParams{
		AttemptID:   attemptID,
		ChallengeID: challengeID,
	})
	require.NoError(t, err)
	require.IsType(t, &api.AuthAttemptResponse{}, verifyResp, "verify %s: %s", method, helpers.MustMarshal(t, verifyResp))
	return verifyResp.(*api.AuthAttemptResponse)
}

// requireProofRejected asserts the specific rejection, not merely a failure: a
// broken endpoint or a validation error must not pass for a correct refusal.
func requireProofRejected(t *testing.T, client *helpers.ApiClient, attemptID api.AttemptID, proof *api.VerifyChallengeRequest) {
	t.Helper()
	challengeID := issueAttemptChallenge(t, client, attemptID, api.FactorMethodIdentifier)
	verifyResp, err := client.VerifyChallengeProof(t.Context(), proof, api.VerifyChallengeProofParams{
		AttemptID:   attemptID,
		ChallengeID: challengeID,
	})
	require.NoError(t, err)
	rejected, ok := verifyResp.(*api.VerifyChallengeProofErrorResponseStatusCode)
	require.True(t, ok, "expected a rejection, got %s", helpers.MustMarshal(t, verifyResp))
	require.Equal(t, http.StatusConflict, rejected.StatusCode, helpers.MustMarshal(t, rejected))
	require.Equal(t, api.AttProofRejectedVerifyChallengeProofErrorResponse, rejected.Response.Type, helpers.MustMarshal(t, rejected))
}

func issueAttemptChallenge(t *testing.T, client *helpers.ApiClient, attemptID api.AttemptID, method api.FactorMethod) api.ChallengeID {
	t.Helper()
	resp, err := client.IssueChallenge(t.Context(), &api.IssueChallengeRequest{Method: method}, api.IssueChallengeParams{AttemptID: attemptID})
	require.NoError(t, err)
	require.IsType(t, &api.ChallengeResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.ChallengeResponse).ChallengeID
}

// The proof is a oneOf, so build it once here rather than at each call site.
func identifierProof(loginName string) *api.VerifyChallengeRequest {
	return &api.VerifyChallengeRequest{
		OneOf: api.NewIdentifierProofVerifyChallengeRequestSum(api.IdentifierProof{LoginName: loginName}),
	}
}

// identifiedUser reads the user an identifier factor resolved to. The attempt's
// top-level user_id is not populated, so the factor's payload is where the
// resolution is visible.
func identifiedUser(t *testing.T, attempt *api.AuthAttemptResponse) string {
	t.Helper()
	for _, factor := range attempt.CompletedFactors {
		if factor.Method == api.FactorMethodIdentifier {
			payload, ok := factor.Payload.Get()
			require.True(t, ok, "identifier factor without a payload")
			return string(payload.IdentifierFactorPayload.UserID)
		}
	}
	t.Fatalf("no identifier factor in %s", helpers.MustMarshal(t, attempt))
	return ""
}

func completedMethods(attempt *api.AuthAttemptResponse) []api.FactorMethod {
	methods := make([]api.FactorMethod, 0, len(attempt.CompletedFactors))
	for _, factor := range attempt.CompletedFactors {
		methods = append(methods, factor.Method)
	}
	return methods
}
