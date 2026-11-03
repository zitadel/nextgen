//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	api "go.zitadel.com/zitadel/v5/api"
)

// Every test creates a project, a connection and users; the Spanner emulator
// starves when that setup runs in parallel, so these tests run sequentially.

// These tests park the provider's result on the attempt through the same
// statements the callback route uses, then drive the resolution through
// GET /flow/{id}. The route itself is covered in sso_callback_flow_test.go.

// ssoResolutionFixture is a project with the sso login flow definition, one
// connection, and a team users can be created in.
type ssoResolutionFixture struct {
	idpFixture
	team       *domain.Team
	connection api.IdpResponse
	// definitionName selects the definition flows start on; empty resolves
	// by audience.
	definitionName string
}

func newSSOResolutionFixture(t *testing.T, connection api.IdpConnection) *ssoResolutionFixture {
	t.Helper()
	f := newIdpFixture(t)
	created := f.create(t, connection)
	defResp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      f.projectID(),
		FlowDefinition: ssoLoginFlowDefinition(defaultSchemaURL()),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: f.project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	return &ssoResolutionFixture{idpFixture: f, team: team, connection: created}
}

// ssoFlow is a started login flow: its id, its cookie and its attempt.
type ssoFlow struct {
	id        string
	zflow     string
	attemptID string
}

// startFlow starts a login flow, on top of session when it is not nil. A flow
// on an existing session must prove it holds it, so the session's token rides
// along with its id.
func (f *ssoResolutionFixture) startFlow(t *testing.T, session *domain.Session) ssoFlow {
	t.Helper()
	req := &api.CreateFlowRequest{ProjectID: f.projectID(), Purpose: api.CreateFlowRequestPurposeLogin}
	if session != nil {
		req.SessionID = api.NewOptString(session.ID)
		req.SessionToken = api.NewOptSessionProofToken(api.SessionProofToken(harness.SessionToken(t, session)))
	}
	if f.definitionName != "" {
		req.FlowDefinitionName = api.NewOptString(f.definitionName)
	}
	resp, err := f.client.CreateFlow(t.Context(), req, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	created := resp.(*api.FlowResponseHeaders)
	zflow := mustExtractZflow(t, created.SetCookie)
	return ssoFlow{
		id:        created.Response.ID,
		zflow:     zflow,
		attemptID: openFlowState(t, f.project.ID, zflow).AuthAttemptID,
	}
}

func (f *ssoResolutionFixture) getStep(t *testing.T, flow ssoFlow) api.GetFlowStepRes {
	t.Helper()
	resp, err := f.client.GetFlowStep(t.Context(), api.GetFlowStepParams{ID: flow.id, Zflow: flow.zflow})
	require.NoError(t, err)
	return resp
}

// createUser stores a user of schemaURL with a random email and returns its id.
func (f *ssoResolutionFixture) createUser(t *testing.T, schemaURL string) string {
	t.Helper()
	id := "user_" + helpers.RandString(8)
	createAttemptUser(t, f.project, f.team, schemaURL, id, map[string]string{"email": helpers.RandString(8) + "@example.com"})
	return id
}

// createStaffSchema adds a second user schema whose email is also
// project-unique, so its users can hold a value the flow's schema looks up.
func (f *ssoResolutionFixture) createStaffSchema(t *testing.T) string {
	t.Helper()
	return harness.CreateUserSchema(t, f.project, `{
		"title": "SSOStaffUser",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://sso-staff.example.com/schemas/staff-user.json",
		"kind": "user-schema",
		"objectType": "sso-staff-user",
		"type": "object",
		"x-identifier": "email",
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"email": {"type": "string", "x-unique": "project"}
		}
	}`)
}

// ssoRevisionedObjectType is the objectType of the schema the revision tests
// republish.
const ssoRevisionedObjectType = "sso-revisioned-user"

// publishRevisionedSchema publishes revision n of the ssoRevisionedObjectType
// schema and returns its id. Every revision after the first adds an optional
// property, the smallest change a republish carries.
func (f *ssoResolutionFixture) publishRevisionedSchema(t *testing.T, n int) string {
	t.Helper()
	properties := map[string]any{"email": map[string]any{"type": "string", "x-unique": "project"}}
	for i := 2; i <= n; i++ {
		properties[fmt.Sprintf("nickname%d", i)] = map[string]any{"type": "string"}
	}
	doc, err := json.Marshal(map[string]any{
		"title":          "SSORevisionedUser",
		"metaSchema":     "https://test.example.schemas.com/schemas/user-schema.json",
		"$id":            fmt.Sprintf("https://sso-revisioned.example.com/schemas/user-v%d.json", n),
		"kind":           "user-schema",
		"objectType":     ssoRevisionedObjectType,
		"type":           "object",
		"x-identifier":   "email",
		"x-auth-methods": map[string]any{"password": map[string]any{"enabled": true}},
		"properties":     properties,
	})
	require.NoError(t, err)
	return harness.CreateUserSchema(t, f.project, string(doc))
}

// useRevisionedSchema starts flows on a definition that names the
// ssoRevisionedObjectType schema by objectType, so they run against its newest
// revision, and returns the id of its first revision.
func (f *ssoResolutionFixture) useRevisionedSchema(t *testing.T) string {
	t.Helper()
	first := f.publishRevisionedSchema(t, 1)
	definition := ssoLoginFlowDefinition(ssoRevisionedObjectType)
	definition.Name = "sso-revisioned-login"
	resp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      f.projectID(),
		FlowDefinition: definition,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, resp, helpers.MustMarshal(t, resp))
	f.definitionName = definition.Name
	return first
}

// link pins subject on connectionID to userID and returns the link.
func (f *ssoResolutionFixture) link(t *testing.T, connectionID, subject, userID string) *domain.IDPIdentityLink {
	t.Helper()
	link := &domain.IDPIdentityLink{ProjectID: f.project.ID, ConnectionID: connectionID, Subject: subject, UserID: userID}
	require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateIDPIdentityLink(t.Context(), link))
	return link
}

func (f *ssoResolutionFixture) attempt(t *testing.T, flow ssoFlow) *domain.AuthAttempt {
	t.Helper()
	attempt, err := harness.EnsureServiceDB(t).Statements().GetAuthAttemptByID(t.Context(), f.project.ID, flow.attemptID)
	require.NoError(t, err)
	return attempt
}

// parkSSOResult stores what a provider callback would: a state issued on the
// attempt, consumed, and given its result.
func parkSSOResult(t *testing.T, projectID, attemptID, revisionID, subject string, claims map[string]any, verified map[string]bool) {
	t.Helper()
	stmts := harness.EnsureServiceDB(t).Statements()
	sso, err := domain.NewSSOState(projectID, "google", revisionID, "https://auth.example.com/__nextgen/idp/google/callback", "/after-login", nil)
	require.NoError(t, err)
	require.NoError(t, stmts.IssueSSOState(t.Context(), projectID, attemptID, sso.Check))
	_, err = stmts.ConsumeSSOState(t.Context(), projectID, sso.Check.StateHash, sso.BindingNonce)
	require.NoError(t, err)
	require.NoError(t, stmts.SetSSOCallbackResult(t.Context(), projectID, sso.Check.StateHash, &domain.SSOCallbackResult{
		Subject:              subject,
		ConnectionRevisionID: revisionID,
		Claims:               claims,
		Verified:             verified,
	}))
}

// openFlowState decrypts a _zflow cookie the way the handler does.
func openFlowState(t *testing.T, projectID, zflow string) domain.FlowState {
	t.Helper()
	crypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), projectID, domain.EncryptionKeyPurposeCookie)
	require.NoError(t, err)
	payload, err := crypter.Decrypt(zflow)
	require.NoError(t, err)
	var state domain.FlowState
	require.NoError(t, json.Unmarshal([]byte(payload), &state))
	return state
}

// sealFlowState encrypts state into a _zflow cookie the way the handler does.
func sealFlowState(t *testing.T, state domain.FlowState) string {
	t.Helper()
	crypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), state.ProjectID, domain.EncryptionKeyPurposeCookie)
	require.NoError(t, err)
	payload, err := json.Marshal(state)
	require.NoError(t, err)
	sealed, err := crypter.Encrypt(string(payload))
	require.NoError(t, err)
	return sealed
}

func emailClaims() map[string]any { return map[string]any{"email": "alice@example.com"} }

func requireAuthenticated(t *testing.T, resp api.GetFlowStepRes) *api.FlowResponseHeaders {
	t.Helper()
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.FlowResponseHeaders)
	require.Equal(t, "done", got.Response.Step.Name)
	assert.True(t, got.Response.HandoffToken.Set, "a resolved sign-in hands off")
	assert.Contains(t, strings.Join(got.SetCookie, "\n"), "Max-Age=0", "the terminal response clears the flow cookie")
	return got
}

// A reload racing a submit must not roll the cookie back to the step before
// the submit.
func TestGetFlowStepWithoutParkedIdentityLeavesCookie(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	flow := f.startFlow(t, nil)

	resp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	assert.Empty(t, resp.(*api.FlowResponseHeaders).SetCookie)
}

// A flow that was complete before the request still answers 410: only a
// render that itself completes the flow returns the terminal step.
func TestGetFlowStep_AlreadyCompleted_Still410(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	flow := f.startFlow(t, nil)
	state := openFlowState(t, f.project.ID, flow.zflow)
	state.CurrentStep = "done"
	flow.zflow = sealFlowState(t, state)

	resp := f.getStep(t, flow)
	require.IsType(t, &api.GetFlowStepGone{}, resp, helpers.MustMarshal(t, resp))
}

func TestSSOResolutionExistingLinkRoutesAuthenticated(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	before, err := harness.EnsureUserFixture(t).GetByID(t.Context(), f.project.ID, userID)
	require.NoError(t, err)
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-1", emailClaims(), map[string]bool{"email": true})

	requireAuthenticated(t, f.getStep(t, flow))

	// A second load with the cookie from before the resolution, as a double
	// load or a second tab sends it: the attempt is handed off, so no second
	// handoff, and the flow restarts instead of showing a step it cannot finish.
	again := f.getStep(t, flow)
	require.IsType(t, &api.GetFlowStepConflict{}, again, helpers.MustMarshal(t, again))
	assert.Equal(t, "flow.restart_required", string(again.(*api.GetFlowStepConflict).Code))

	attempt := f.attempt(t, flow)
	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, userID, userFactor.UserID)
	after, err := harness.EnsureUserFixture(t).GetByID(t.Context(), f.project.ID, userID)
	require.NoError(t, err)
	assert.Equal(t, before.Attributes, after.Attributes, "resolution does not touch the user")
}

// A submit with the cookie from before the handoff restarts the flow too, so
// the login UI starts over instead of showing the startup error.
func TestSSOResolutionSubmitAfterHandoffReturns409(t *testing.T) {
	t.Parallel()
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	f.link(t, f.connection.ID, "sub-1", f.createUser(t, defaultSchemaURL()))
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-1", emailClaims(), map[string]bool{"email": true})
	requireAuthenticated(t, f.getStep(t, flow))

	resp, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"alice@example.com"`),
		}),
	}, api.SubmitFlowStepParams{ID: flow.id, Zflow: flow.zflow})
	require.NoError(t, err)
	require.IsType(t, &api.ErrorDetails{}, resp, helpers.MustMarshal(t, resp))
	assert.Equal(t, "flow.restart_required", string(resp.(*api.ErrorDetails).Code))
}

func TestSSOResolutionLaterRevisionResolvesSameLink(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	revised := helpers.OIDCConnection("google")
	revised.DisplayName = "Google Workspace"
	later := f.revise(t, revised)
	require.NotEqual(t, f.connection.RevisionID, later.RevisionID)
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, later.RevisionID, "sub-1", emailClaims(), nil)

	requireAuthenticated(t, f.getStep(t, flow))
}

func TestSSOResolutionOtherConnectionSameSubjectDoesNotMatch(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	other := f.create(t, helpers.OIDCConnection("corp"))
	f.link(t, f.connection.ID, "sub-1", f.createUser(t, defaultSchemaURL()))
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, other.RevisionID, "sub-1", emailClaims(), nil)

	resp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.FlowResponseHeaders).Response
	assert.Equal(t, "identifier", got.Step.Name, "no link on the other connection, so nobody signs in")
	assert.False(t, got.HandoffToken.Set)
	// The unverified email cannot create a user, so the identity is collected;
	// this definition does not route that outcome.
	assert.Equal(t, domain.FlowStepErrorSSOUserNotFound, got.Step.Error.Value)
	_, parked := f.attempt(t, flow).SSOCallback()
	assert.True(t, parked, "a collected identity stays parked for the prefill")
}

func TestSSOResolutionStoresNoProviderToken(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	userID := f.createUser(t, defaultSchemaURL())
	link := f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-1", emailClaims(), map[string]bool{"email": true})

	requireAuthenticated(t, f.getStep(t, flow))

	attempt := f.attempt(t, flow)
	_, parked := attempt.SSOCallback()
	assert.False(t, parked, "the parked result is deleted once used")
	ssoFactor, ok := domain.CheckAs[*domain.AuthFactorSSO](attempt, domain.AuthCheckTypeSSO)
	require.True(t, ok)
	payload, err := json.Marshal(ssoFactor.Payload())
	require.NoError(t, err)
	assert.JSONEq(t, `{"connection_id":"`+f.connection.ID+`","link_id":"`+link.ID+`","attempt_id":"`+flow.attemptID+`"}`, string(payload),
		"the sso factor holds the connection, link and attempt ids, nothing the provider asserted")
}

func TestSSOResolutionOtherSchemaReturns409(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	staffSchemaURL := f.createStaffSchema(t)
	f.link(t, f.connection.ID, "sub-1", f.createUser(t, staffSchemaURL))
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-1", emailClaims(), nil)

	resp := f.getStep(t, flow)
	require.IsType(t, &api.GetFlowStepConflict{}, resp, helpers.MustMarshal(t, resp))
	assert.Equal(t, "flow.restart_required", string(resp.(*api.GetFlowStepConflict).Code))
	body := helpers.MustMarshal(t, resp)
	for _, leaked := range []string{staffSchemaURL, defaultSchemaURL(), "sub-1", "alice@example.com", f.connection.ID} {
		assert.False(t, strings.Contains(body, leaked), "the response must not carry %q: %s", leaked, body)
	}
}

// A user keeps the schema revision it was created under. Republishing the
// schema must not lock the users already linked to a provider out.
func TestSSOResolutionLinkedUserOnOlderSchemaRevisionRoutesAuthenticated(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	firstRevision := f.useRevisionedSchema(t)
	userID := f.createUser(t, firstRevision)
	f.link(t, f.connection.ID, "sub-1", userID)
	require.NotEqual(t, firstRevision, f.publishRevisionedSchema(t, 2))
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-1", emailClaims(), map[string]bool{"email": true})

	requireAuthenticated(t, f.getStep(t, flow))

	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, userID, userFactor.UserID)
	user, err := harness.EnsureUserFixture(t).GetByID(t.Context(), f.project.ID, userID)
	require.NoError(t, err)
	assert.Equal(t, firstRevision, user.SchemaURL, "signing in does not move the user to the newer revision")
}

// The owner of a claimed unique value created under an older revision of the
// flow's schema is a collision to sign in, not a user of another schema.
func TestSSOResolutionCollisionWithOwnerOnOlderSchemaRevisionBinds(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	firstRevision := f.useRevisionedSchema(t)
	email := helpers.RandString(8) + "@example.com"
	ownerID := "user_" + helpers.RandString(8)
	createAttemptUser(t, f.project, f.team, firstRevision, ownerID, map[string]string{"email": email})
	f.publishRevisionedSchema(t, 2)
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{"email": email}, map[string]bool{"email": true})

	resp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	assert.Equal(t, "identifier", resp.(*api.FlowResponseHeaders).Response.Step.Name)
	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, ownerID, userFactor.UserID, "the attempt is bound to the existing user")
	_, err := f.linkFor(t, "sub-new")
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "a collision links nothing")
	owner, err := f.userByEmail(t, email)
	require.NoError(t, err)
	assert.Equal(t, ownerID, owner.ID, "no second user was created")
	assert.Equal(t, firstRevision, owner.SchemaURL, "the owner stays on its revision")
}

func TestSSOResolutionCreationDisabledRerendersWithError(t *testing.T) {
	connection := helpers.OIDCConnection("google")
	connection.Provisioning = api.NewOptIdpConnectionProvisioning(api.IdpConnectionProvisioning{
		Creation: api.NewOptIdpConnectionProvisioningCreation(api.IdpConnectionProvisioningCreationDisabled),
	})
	f := newSSOResolutionFixture(t, connection)
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-unknown", emailClaims(), nil)

	resp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	step := resp.(*api.FlowResponseHeaders).Response.Step
	assert.Equal(t, "identifier", step.Name)
	assert.Equal(t, domain.FlowStepErrorSSOCreationDisabled, step.Error.Value)
	_, parked := f.attempt(t, flow).SSOCallback()
	assert.True(t, parked, "the parked result stays, so a lost response can show the error again")

	// The rotated cookie carries the replay guard: the next load renders the
	// step without the error.
	flow.zflow = mustExtractZflow(t, resp.(*api.FlowResponseHeaders).SetCookie)
	again := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, again, helpers.MustMarshal(t, again))
	assert.Equal(t, "identifier", again.(*api.FlowResponseHeaders).Response.Step.Name)
	assert.False(t, again.(*api.FlowResponseHeaders).Response.Step.Error.Set)
}

func TestSSOResolutionOnBoundAttemptRebindsNothing(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	userA := f.createUser(t, defaultSchemaURL())
	userB := f.createUser(t, defaultSchemaURL())
	session := harness.CreateActiveSession(t, f.project.ID, userA)
	f.link(t, f.connection.ID, "sub-b", userB)
	flow := f.startFlow(t, session)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-b", emailClaims(), nil)

	resp := f.getStep(t, flow)
	require.IsType(t, &api.GetFlowStepConflict{}, resp, helpers.MustMarshal(t, resp))

	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, userA, userFactor.UserID, "the attempt still carries the session's user")
	link, err := harness.EnsureServiceDB(t).Statements().GetIDPIdentityLink(t.Context(), database.And(
		database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), f.project.ID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldConnectionID), f.connection.ID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldSubject), "sub-b"),
	))
	require.NoError(t, err)
	assert.Equal(t, userB, link.UserID, "the link is untouched")
}

// linkFor returns the link of subject on the fixture's connection.
func (f *ssoResolutionFixture) linkFor(t *testing.T, subject string) (*domain.IDPIdentityLink, error) {
	t.Helper()
	return harness.EnsureServiceDB(t).Statements().GetIDPIdentityLink(t.Context(), database.And(
		database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), f.project.ID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldConnectionID), f.connection.ID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldSubject), subject),
	))
}

func (f *ssoResolutionFixture) userByEmail(t *testing.T, email string) (*domain.User, error) {
	t.Helper()
	return harness.EnsureUserFixture(t).GetByAttributes(t.Context(), f.project.ID, []domain.Attribute{{Key: "email", Value: email}})
}

// requireCollected asserts sso_user_not_found on a definition that does not
// route it, with nothing created and the parked row kept for the prefill.
func (f *ssoResolutionFixture) requireCollected(t *testing.T, flow ssoFlow, resp api.GetFlowStepRes, subject string) *domain.SSOCallbackCheck {
	t.Helper()
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.FlowResponseHeaders).Response
	assert.Equal(t, "identifier", got.Step.Name)
	assert.Equal(t, domain.FlowStepErrorSSOUserNotFound, got.Step.Error.Value)
	assert.False(t, got.HandoffToken.Set)
	attempt := f.attempt(t, flow)
	_, bound := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	assert.False(t, bound, "nobody is bound")
	_, err := f.linkFor(t, subject)
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "nothing is linked")
	parked, ok := attempt.SSOCallback()
	require.True(t, ok, "the parked row stays for the prefill")
	require.NotNil(t, parked.Result)
	return parked
}

func TestSSOResolutionCollisionBindsAndKeepsParked(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	email := helpers.RandString(8) + "@example.com"
	ownerID := "user_" + helpers.RandString(8)
	createAttemptUser(t, f.project, f.team, defaultSchemaURL(), ownerID, map[string]string{"email": email})
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{"email": email}, map[string]bool{"email": true})

	resp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	got := resp.(*api.FlowResponseHeaders).Response
	// The outcome routes back to the identifier step, where the owner signs in.
	assert.Equal(t, "identifier", got.Step.Name)
	assert.False(t, got.Step.Error.Set)
	assert.False(t, got.HandoffToken.Set, "the owner still has to prove a factor")

	attempt := f.attempt(t, flow)
	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, ownerID, userFactor.UserID, "the attempt is bound to the existing user")
	_, hasSSO := domain.CheckAs[*domain.AuthFactorSSO](attempt, domain.AuthCheckTypeSSO)
	assert.False(t, hasSSO, "a collision proves nothing about the account")
	row, parked := attempt.SSOCallback()
	require.True(t, parked, "the parked row stays, so a lost cookie can be recovered")
	require.NotNil(t, row.Result)
	assert.Equal(t, &domain.SSOCallbackResult{CollisionUserID: ownerID}, row.Result,
		"the row holds only the marker: the provider's subject and claims are gone")
	_, err := f.linkFor(t, "sub-new")
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "a collision links nothing")
	owner, err := f.userByEmail(t, email)
	require.NoError(t, err)
	assert.Equal(t, ownerID, owner.ID, "no second user was created")

	// The client lost the sealed cookie and retries with the one it had
	// before: the marker catches the state up and the same outcome is raised.
	retry := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, retry, helpers.MustMarshal(t, retry))
	assert.Equal(t, "identifier", retry.(*api.FlowResponseHeaders).Response.Step.Name)
	userFactor, ok = domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, ownerID, userFactor.UserID)
}

// The registry key has no schema, so a user of another schema can own the
// claimed value. The flow cannot continue with that user: it restarts, and
// nothing is bound, linked or created.
func TestSSOResolutionCollisionWithOtherSchemaOwnerReturns409(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	staffSchemaURL := f.createStaffSchema(t)
	email := helpers.RandString(8) + "@example.com"
	ownerID := "user_" + helpers.RandString(8)
	createAttemptUser(t, f.project, f.team, staffSchemaURL, ownerID, map[string]string{"email": email})
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{"email": email}, map[string]bool{"email": true})

	resp := f.getStep(t, flow)
	require.IsType(t, &api.GetFlowStepConflict{}, resp, helpers.MustMarshal(t, resp))
	assert.Equal(t, "flow.restart_required", string(resp.(*api.GetFlowStepConflict).Code))
	body := helpers.MustMarshal(t, resp)
	for _, leaked := range []string{staffSchemaURL, ownerID, email, "sub-new"} {
		assert.False(t, strings.Contains(body, leaked), "the response must not carry %q: %s", leaked, body)
	}

	_, bound := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
	assert.False(t, bound, "the owner of another schema is not bound")
	_, err := f.linkFor(t, "sub-new")
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "nothing is linked")
	owner, err := f.userByEmail(t, email)
	require.NoError(t, err)
	assert.Equal(t, ownerID, owner.ID, "no second user was created")
}

func TestSSOResolutionAutoCreateCreatesUserAndLinkAtomically(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	email := helpers.RandString(8) + "@example.com"
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{"email": email}, map[string]bool{"email": true})

	requireAuthenticated(t, f.getStep(t, flow))

	user, err := f.userByEmail(t, email)
	require.NoError(t, err)
	assert.Equal(t, defaultSchemaURL(), user.SchemaURL)
	link, err := f.linkFor(t, "sub-new")
	require.NoError(t, err)
	assert.Equal(t, user.ID, link.UserID)
	attempt := f.attempt(t, flow)
	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, user.ID, userFactor.UserID)
	ssoFactor, ok := domain.CheckAs[*domain.AuthFactorSSO](attempt, domain.AuthCheckTypeSSO)
	require.True(t, ok)
	assert.Equal(t, f.connection.ID, ssoFactor.ConnectionID)
	assert.Equal(t, link.ID, ssoFactor.LinkID)
	_, parked := attempt.SSOCallback()
	assert.False(t, parked, "the parked row is deleted")
}

// Through GET the link lookup runs before creation, so a link insert only
// fails when another sign-in links the subject in between. This drives the
// create directly to land in that window: the user insert succeeds, the link
// trips the pair index, and the whole transaction rolls back.
func TestSSOResolutionAutoCreateRollsBackOnLinkFailure(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	f.link(t, f.connection.ID, "sub-taken", f.createUser(t, defaultSchemaURL()))
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-taken", emailClaims(), map[string]bool{"email": true})
	email := helpers.RandString(8) + "@example.com"
	resolver := service.NewFlowSSOIdentityResolver(
		harness.EnsureServiceDB(t), harness.EnsureIDPConnectionService(t), harness.EnsureUserService(t), harness.EnsureSchemaStore(t), harness.EnsureProjectHashers(t), harness.EnsurePasswordPolicy(t),
	)
	parked, ok := f.attempt(t, flow).SSOCallback()
	require.True(t, ok)

	_, err := resolver.CreateLinked(t.Context(), domain.FlowSSOCreateInput{
		ProjectID:     f.project.ID,
		AttemptID:     flow.attemptID,
		CheckID:       parked.ID,
		UserSchemaURL: defaultSchemaURL(),
		ConnectionID:  f.connection.ID,
		Subject:       "sub-taken",
		Attributes:    map[string]any{"email": email},
	})
	require.ErrorIs(t, err, domain.ErrUserAlreadyExists())

	_, err = f.userByEmail(t, email)
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "the user rolls back with the link")
	attempt := f.attempt(t, flow)
	_, bound := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	assert.False(t, bound, "no factor is recorded")
	survived, ok := attempt.SSOCallback()
	require.True(t, ok, "the parked row survives the rollback")
	assert.Equal(t, parked.ID, survived.ID)
}

func TestSSOResolutionMissingRequiredRoutesSSOUserNotFound(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{}, nil)

	resp := f.getStep(t, flow)
	f.requireCollected(t, flow, resp, "sub-new")

	// The rotated cookie remembers the row, so a reload renders the step
	// instead of resolving the identity again.
	flow.zflow = mustExtractZflow(t, resp.(*api.FlowResponseHeaders).SetCookie)
	reload := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, reload, helpers.MustMarshal(t, reload))
	assert.False(t, reload.(*api.FlowResponseHeaders).Response.Step.Error.Set)
}

func TestSSOResolutionUnverifiedUniqueRoutesSSOUserNotFound(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	email := helpers.RandString(8) + "@example.com"
	flow := f.startFlow(t, nil)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{"email": email}, map[string]bool{"email": false})

	parked := f.requireCollected(t, flow, f.getStep(t, flow), "sub-new")
	verified, ok := parked.Result.Verified["email"]
	assert.True(t, ok)
	assert.False(t, verified, "the prefill knows the email still needs proving")
	_, err := f.userByEmail(t, email)
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "no user is created from an unverified email")
}

// A flow started on a signed-in session carries that session's user on its
// attempt. An unlinked identity that does not collide with that user cannot
// register a new one there, nor be collected: the flow starts over.
func TestSSOResolutionUnlinkedIdentityOnSessionBoundAttemptRestarts(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))
	userA := f.createUser(t, defaultSchemaURL())
	session := harness.CreateActiveSession(t, f.project.ID, userA)
	flow := f.startFlow(t, session)
	parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-new", map[string]any{}, nil)

	resp := f.getStep(t, flow)
	require.IsType(t, &api.GetFlowStepConflict{}, resp, helpers.MustMarshal(t, resp))
	assert.Equal(t, "flow.restart_required", string(resp.(*api.GetFlowStepConflict).Code))
	_, err := f.linkFor(t, "sub-new")
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "nothing is linked")
}
