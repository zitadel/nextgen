//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// mustInitClaim starts a claim on the project and returns the 201 body.
func mustInitClaim(t *testing.T, client *helpers.ApiClient, projectID string) *api.InitClaimResponse {
	t.Helper()

	resp, err := client.InitClaim(t.Context(), api.InitClaimParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	require.IsType(t, &api.InitClaimResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.InitClaimResponse)
}

// exchangeForSessionCookie trades a handoff token for the __nextgen_session
// cookie over the real /sessions/exchange endpoint (session_me_test pattern).
func exchangeForSessionCookie(t *testing.T, projectID, projectSecret, handoffToken string) *http.Cookie {
	t.Helper()

	body, err := json.Marshal(map[string]string{"handoff_token": handoffToken})
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/sessions/exchange?project_id="+projectID, bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+projectSecret)

	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(raw))

	for _, cookie := range resp.Cookies() {
		if cookie.Name == "__nextgen_session" {
			return cookie
		}
	}
	t.Fatal("exchange must set the __nextgen_session cookie")
	return nil
}

// platformSessionCookie signs the user into the platform project by seeding a
// handed-off attempt with a verified user factor and exchanging it for the
// session cookie. For tests where the login mechanics are not the thing under
// test; TestClaimHappyPath drives the real flow engine instead.
func platformSessionCookie(t *testing.T, userID string) *http.Cookie {
	t.Helper()

	platform := harness.EnsurePlatformProject(t)
	attempt := &domain.AuthAttempt{
		ProjectID:      platform.ID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		Checks:         []domain.AuthCheck{&domain.AuthFactorUser{UserID: userID}},
	}
	stmts := harness.EnsureServiceDB(t)
	require.NoError(t, stmts.Statements().CreateAuthAttempt(t.Context(), attempt))
	plainToken := "handoff_claim_" + helpers.RandString(8)
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, stmts.Statements().HandoffAuthAttempt(t.Context(), attempt))

	return exchangeForSessionCookie(t, platform.ID, harness.ProjectSecret(t, platform), plainToken)
}

// TestClaimHappyPath is the ticket's end-to-end leg: init → pending status →
// a REAL flow-engine password login on the platform project → handoff exchange
// for the session cookie → complete → completed status, so the claim/complete
// session precondition (ADR 046 §2) is exercised against a session the flow
// engine actually minted.
func TestClaimHappyPath(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	initOK := mustInitClaim(t, client, project.ID)
	assert.True(t, strings.HasPrefix(string(initOK.ChallengeID), "ch_"), string(initOK.ChallengeID))
	assert.WithinDuration(t, time.Now().Add(domain.ClaimChallengeTTL), initOK.ExpiresAt, time.Minute)
	assert.True(t, strings.HasSuffix(initOK.ClaimURL.Path, "/claim"), initOK.ClaimURL.String())
	query := initOK.ClaimURL.Query()
	assert.Equal(t, string(initOK.ChallengeID), query.Get("challenge_id"))
	assert.Equal(t, project.ID, query.Get("project_id"))

	statusResp, err := client.GetClaimStatus(t.Context(), api.GetClaimStatusParams{
		ProjectID:   api.ProjectID(project.ID),
		ChallengeID: initOK.ChallengeID,
	})
	require.NoError(t, err)
	require.IsType(t, &api.ClaimStatusResponse{}, statusResp, helpers.MustMarshal(t, statusResp))
	assert.True(t, statusResp.(*api.ClaimStatusResponse).IsClaimStatusPending(), helpers.MustMarshal(t, statusResp))

	// The human on the platform project: their earliest active membership is
	// the personal team the claim lands on.
	platform := harness.EnsurePlatformProject(t)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	userID := "user_" + helpers.RandString(8)
	userEmail := helpers.RandString(8) + "@example.com"
	const userPass = "correct-horse-battery-staple"

	emailAttr, err := domain.NewCreateAttribute("email", userEmail, domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:               platform.ID,
		SchemaURL:               schemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))
	encodedHash, err := harness.EnsureHasher(t).Hash(userPass)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).SetPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   platform.ID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}))

	// Real password login over the flow REST API (password_flow_test shape).
	platClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, platClient, platform)

	defResp, err := platClient.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(platform.ID),
		FlowDefinition: passwordLoginFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))

	createResp, err := platClient.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(platform.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	idResp, err := platClient.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + userEmail + `"`),
		}),
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: zflow})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, idResp, helpers.MustMarshal(t, idResp))
	idOK := idResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "password", idOK.Response.Step.Name)
	zflow = mustExtractZflow(t, idOK.SetCookie.Value)

	pwResp, err := platClient.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"x-auth-methods#password": jx.Raw(`"` + userPass + `"`),
		}),
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: zflow})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, pwResp, helpers.MustMarshal(t, pwResp))
	pwOK := pwResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "done", pwOK.Response.Step.Name)
	handoffToken, hasToken := pwOK.Response.HandoffToken.Get()
	require.True(t, hasToken, "expected handoff token after successful password login")

	sessionCookie := exchangeForSessionCookie(t, platform.ID, platClient.Token(), handoffToken)

	client.SetSessionToken(sessionCookie.Value)
	completeResp, err := client.CompleteClaim(t.Context(),
		&api.CompleteClaimRequest{ChallengeID: initOK.ChallengeID},
		api.CompleteClaimParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.CompleteClaimResponse{}, completeResp, helpers.MustMarshal(t, completeResp))
	completed := completeResp.(*api.CompleteClaimResponse)
	assert.Equal(t, api.ProjectID(project.ID), completed.ProjectID)
	assert.Equal(t, api.TeamID(team.ID), completed.TeamID)
	assert.WithinDuration(t, time.Now(), completed.ClaimedAt, time.Minute)

	statusResp, err = client.GetClaimStatus(t.Context(), api.GetClaimStatusParams{
		ProjectID:   api.ProjectID(project.ID),
		ChallengeID: initOK.ChallengeID,
	})
	require.NoError(t, err)
	require.IsType(t, &api.ClaimStatusResponse{}, statusResp, helpers.MustMarshal(t, statusResp))
	completedStatus, ok := statusResp.(*api.ClaimStatusResponse).GetClaimStatusCompleted()
	require.True(t, ok, helpers.MustMarshal(t, statusResp))
	assert.Equal(t, api.TeamID(team.ID), completedStatus.TeamID)
	assert.True(t, strings.HasSuffix(completedStatus.DashboardURL.Path, "/projects/"+project.ID),
		completedStatus.DashboardURL.String())

	// The claim's durable side effect: the active owning-team grant exists
	// (the claim source of truth, ADR 046 / ADR 054 §2).
	grant, err := harness.EnsureServiceDB(t).Statements().GetActiveOwningTeamGrant(t.Context(), project.ID)
	require.NoError(t, err)
	assert.Equal(t, team.ID, grant.PrincipalID)
}

// TestInitClaimAlreadyClaimed pins the exact 409 wire body on a raw request:
// the CLI reads error.body.details.team_id, so the details must stay flat
// (not nested under details.details like the generic ADR 030 envelope).
func TestInitClaimAlreadyClaimed(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	// The claiming team lives in the platform project, like every real claim.
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: harness.EnsurePlatformProject(t).ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	// Claimed state exactly as Complete writes it: the active owning-team
	// grant, the claim source of truth (ADR 046 / ADR 054 §2).
	require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(),
		domain.NewClaimTeamAssignment(project.ID, team.ID)))

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/projects/"+project.ID+"/claim/init", nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+harness.ProjectSecret(t, project))

	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusConflict, resp.StatusCode, string(raw))

	var got struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details struct {
			TeamID       string          `json:"team_id"`
			DashboardURL string          `json:"dashboard_url"`
			Details      json.RawMessage `json:"details"`
		} `json:"details"`
	}
	require.NoError(t, json.Unmarshal(raw, &got))
	assert.Equal(t, "proj.already_claimed", got.Code)
	assert.Equal(t, team.ID, got.Details.TeamID)
	assert.Equal(t, "https://console.invalid/ui/console/projects/"+project.ID, got.Details.DashboardURL)
	assert.Nil(t, got.Details.Details, "conflict details must be flat, not the nested ADR 030 envelope")
}

// TestClaimExpiredChallenge seeds the challenge row directly with a past
// expiry (no sleeping, no clock injection) and expects 410 on both legs.
func TestClaimExpiredChallenge(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	secret := harness.ProjectSecret(t, project)

	plain := "ch_" + helpers.RandString(16)
	challenge, err := domain.NewClaimChallenge(domain.HashClaimChallengeToken(plain), project.ID,
		domain.HashSecret(secret), time.Now().Add(-time.Minute))
	require.NoError(t, err)
	require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateChallenge(t.Context(), challenge))

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	// The same bearer the seeded InitiatingSecretHash derives from, so the
	// proof-of-possession gate passes and expiry is what answers.
	client.SetToken(secret)

	statusResp, err := client.GetClaimStatus(t.Context(), api.GetClaimStatusParams{
		ProjectID:   api.ProjectID(project.ID),
		ChallengeID: api.ChallengeID(plain),
	})
	require.NoError(t, err)
	require.IsType(t, &api.ProjClaimExpired{}, statusResp, helpers.MustMarshal(t, statusResp))

	userID := harness.CreateUserWithTeam(t, harness.EnsurePlatformProject(t).ID)
	client.SetSessionToken(platformSessionCookie(t, userID).Value)
	completeResp, err := client.CompleteClaim(t.Context(),
		&api.CompleteClaimRequest{ChallengeID: api.ChallengeID(plain)},
		api.CompleteClaimParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.ProjClaimExpired{}, completeResp, helpers.MustMarshal(t, completeResp))
}

// TestCompleteClaimNoPersonalTeam: the session user is authenticated but has
// no team membership at all, so there is no personal team to attach the
// project to — 403 with code claim.no_personal_team. Reachable until #527
// auto-creates the personal team at registration.
func TestCompleteClaimNoPersonalTeam(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	initOK := mustInitClaim(t, client, project.ID)

	// A platform user without any team: created with no initial membership,
	// unlike CreateUserWithTeam.
	userID := "user_" + helpers.RandString(8)
	emailAttr, err := domain.NewCreateAttribute("email", helpers.RandString(8)+"@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:  harness.EnsurePlatformProject(t).ID,
		SchemaURL:  apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
		ID:         userID,
		Attributes: domain.CreateAttributes{*emailAttr},
	}))

	client.SetSessionToken(platformSessionCookie(t, userID).Value)
	resp, err := client.CompleteClaim(t.Context(),
		&api.CompleteClaimRequest{ChallengeID: initOK.ChallengeID},
		api.CompleteClaimParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.ClaimNoPersonalTeam{}, resp, helpers.MustMarshal(t, resp))
	assert.Equal(t, "claim.no_personal_team", resp.(*api.ClaimNoPersonalTeam).GetCode())
}

// TestClaimStatusBearerMismatch: a valid project.write bearer for the same
// project that is not the initiating one passes the authz gate but fails the
// constant-time secret-hash compare → 403, before expiry is even evaluated.
func TestClaimStatusBearerMismatch(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	secretA := harness.ProjectSecret(t, project)
	secretB := harness.ProjectSecret(t, project)
	// JWE minting is randomized: each mint is a distinct bearer string, hence
	// a distinct SHA-256, even for the same project.
	require.NotEqual(t, secretA, secretB)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(secretA)
	initOK := mustInitClaim(t, client, project.ID)

	client.SetToken(secretB)
	statusResp, err := client.GetClaimStatus(t.Context(), api.GetClaimStatusParams{
		ProjectID:   api.ProjectID(project.ID),
		ChallengeID: initOK.ChallengeID,
	})
	require.NoError(t, err)
	require.IsType(t, &api.ProjPermissionDenied{}, statusResp, helpers.MustMarshal(t, statusResp))
}

// TestCompleteClaimConcurrent races two completes of the same challenge:
// exactly one wins. The loser's verdict is dialect-dependent: on Postgres it
// loses the pending→completed UPDATE and gets 410; on Spanner the aborted
// transaction is retried after the winner commits, sees the claimed team, and
// gets 409 with the conflict details (service/claim.go documents this).
func TestCompleteClaimConcurrent(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	initClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, initClient, project)
	initOK := mustInitClaim(t, initClient, project.ID)

	userID := harness.CreateUserWithTeam(t, harness.EnsurePlatformProject(t).ID)
	cookie := platformSessionCookie(t, userID)

	const racers = 2
	results := make([]api.CompleteClaimRes, racers)
	errs := make([]error, racers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range racers {
		// One client per goroutine: the fake security source is mutable state.
		c, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		c.SetSessionToken(cookie.Value)
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release together so the completes genuinely overlap
			results[i], errs[i] = c.CompleteClaim(t.Context(),
				&api.CompleteClaimRequest{ChallengeID: initOK.ChallengeID},
				api.CompleteClaimParams{ProjectID: api.ProjectID(project.ID)})
		}()
	}
	close(start)
	wg.Wait()

	var winners, losers int
	for i := range results {
		require.NoError(t, errs[i])
		switch results[i].(type) {
		case *api.CompleteClaimResponse:
			winners++
		case *api.ProjClaimExpired, *api.AlreadyClaimedResponse:
			losers++
		default:
			t.Fatalf("unexpected complete result: %T %s", results[i], helpers.MustMarshal(t, results[i]))
		}
	}
	assert.Equal(t, 1, winners, "exactly one concurrent complete must win")
	assert.Equal(t, 1, losers)
}

// TestCompleteClaimCrossChallengeRace races two completes of two DIFFERENT
// pending challenges on one project: exactly one wins and the loser gets the
// 409 with the winning team, on both dialects. Postgres decides it at the
// authz_assignments_one_owning_team unique index (ADR 054 §2); Spanner's
// serializable read-write transaction aborts and replays the loser, which then
// sees the winner's grant in the claimed-check.
func TestCompleteClaimCrossChallengeRace(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	initClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, initClient, project)
	challenges := []api.ChallengeID{
		mustInitClaim(t, initClient, project.ID).ChallengeID,
		mustInitClaim(t, initClient, project.ID).ChallengeID,
	}

	userID := harness.CreateUserWithTeam(t, harness.EnsurePlatformProject(t).ID)
	cookie := platformSessionCookie(t, userID)

	results := make([]api.CompleteClaimRes, len(challenges))
	errs := make([]error, len(challenges))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range challenges {
		c, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		c.SetSessionToken(cookie.Value)
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release together so the completes genuinely overlap
			results[i], errs[i] = c.CompleteClaim(t.Context(),
				&api.CompleteClaimRequest{ChallengeID: challenges[i]},
				api.CompleteClaimParams{ProjectID: api.ProjectID(project.ID)})
		}()
	}
	close(start)
	wg.Wait()

	var winners, losers int
	for i := range results {
		require.NoError(t, errs[i])
		switch res := results[i].(type) {
		case *api.CompleteClaimResponse:
			winners++
		case *api.AlreadyClaimedResponse:
			losers++
			assert.NotEmpty(t, res.Details.TeamID, "the 409 must name the winning team")
		default:
			t.Fatalf("unexpected complete result: %T %s", results[i], helpers.MustMarshal(t, results[i]))
		}
	}
	assert.Equal(t, 1, winners, "exactly one concurrent complete must win")
	assert.Equal(t, 1, losers)
}

// TestClaimAuthNegatives sends raw requests without credentials (the generated
// client refuses to send a missing credential, helpers/client.go).
func TestClaimAuthNegatives(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	serverURL := harness.EnsureTestServer(t).URL

	do := func(t *testing.T, method, url string, body io.Reader) (int, *api.ErrorDetails) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, url, body)
		require.NoError(t, err)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer func() { _ = resp.Body.Close() }()
		raw, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		return resp.StatusCode, helpers.MustUnmarshal[api.ErrorDetails](t, raw)
	}

	t.Run("init without bearer", func(t *testing.T) {
		t.Parallel()
		status, details := do(t, http.MethodPost, serverURL+"/projects/"+project.ID+"/claim/init", nil)
		assert.Equal(t, http.StatusUnauthorized, status)
		assert.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
	})

	t.Run("status without bearer", func(t *testing.T) {
		t.Parallel()
		status, details := do(t, http.MethodGet,
			serverURL+"/projects/"+project.ID+"/claim/status?challenge_id=ch_x", nil)
		assert.Equal(t, http.StatusUnauthorized, status)
		assert.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
	})

	t.Run("complete without cookie", func(t *testing.T) {
		t.Parallel()
		status, details := do(t, http.MethodPost,
			serverURL+"/projects/"+project.ID+"/claim/complete",
			strings.NewReader(`{"challenge_id":"ch_x"}`))
		assert.Equal(t, http.StatusUnauthorized, status)
		assert.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
		// The cookie-secured operations answer with the normalized session
		// message (OgenErrorHandler + sessionCookieOperations).
		assert.Equal(t, "Missing or invalid session token.", details.Message)
	})
}
