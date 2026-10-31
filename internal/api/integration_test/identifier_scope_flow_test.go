//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// An identifier submitted through a login flow resolves only among the users
// of the schema the flow is bound to, across every revision of it (ADR 058 §5).

const identifierScopePassword = "correct-horse-battery-staple"

type identifierScopeFixture struct {
	project *domain.Project
	team    *domain.Team
	client  *helpers.ApiClient
}

func newIdentifierScopeFixture(t *testing.T) *identifierScopeFixture {
	t.Helper()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	deployPrimary(t, project.ID)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	return &identifierScopeFixture{project: project, team: team, client: client}
}

// createSchema publishes a user schema holding email and returns its id. With
// designated, email is the schema's x-identifier and password sign-in is
// enabled. Extra optional properties make a republish of the same objectType a
// new revision.
func (f *identifierScopeFixture) createSchema(t *testing.T, id, objectType string, designated bool, unique string, extra ...string) string {
	t.Helper()
	properties := map[string]any{"email": map[string]any{"type": "string", "x-unique": unique}}
	for _, name := range extra {
		properties[name] = map[string]any{"type": "string"}
	}
	doc := map[string]any{
		"title":      "IdentifierScopeUser",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id":        id,
		"kind":       "user-schema",
		"objectType": objectType,
		"type":       "object",
		// Password sign-in needs a designated identifier.
		"x-auth-methods": map[string]any{"password": map[string]any{"enabled": designated}},
		"properties":     properties,
	}
	if designated {
		doc["x-identifier"] = "email"
	}
	raw, err := json.Marshal(doc)
	require.NoError(t, err)
	return harness.CreateUserSchema(t, f.project, string(raw))
}

// createUser stores a user of schemaURL whose email is registered under the
// given uniqueness scope, with the test password.
func (f *identifierScopeFixture) createUser(t *testing.T, schemaURL, email string, unique domain.AttributeUniqueness) string {
	t.Helper()
	id := "user_" + helpers.RandString(8)
	attr, err := domain.NewCreateAttribute("email", email, unique)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:               f.project.ID,
		SchemaURL:               schemaURL,
		ID:                      id,
		InitialMembershipTeamID: &f.team.ID,
		Attributes:              domain.CreateAttributes{*attr},
	}))
	setAttemptPassword(t, f.project, id, identifierScopePassword)
	return id
}

// submitIdentifier starts a login flow on definition and submits email on its
// identifier step. It returns the flow id and the response.
func (f *identifierScopeFixture) submitIdentifier(t *testing.T, definition api.FlowDefinition, email string) (string, *api.SubmitFlowStepOK) {
	t.Helper()
	defResp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(f.project.ID),
		FlowDefinition: definition,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))

	createResp, err := f.client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(f.project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	}, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	created := createResp.(*api.FlowResponseHeaders)

	resp, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + email + `"`),
		}),
	}, api.SubmitFlowStepParams{ID: created.Response.ID, Zflow: mustExtractZflow(t, created.SetCookie)})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, resp, helpers.MustMarshal(t, resp))
	return created.Response.ID, resp.(*api.SubmitFlowStepOK)
}

// signIn runs definition's login with email and the test password and
// requires the handoff.
func (f *identifierScopeFixture) signIn(t *testing.T, definition api.FlowDefinition, email string) {
	t.Helper()
	flowID, idOK := f.submitIdentifier(t, definition, email)
	require.Equal(t, "password", idOK.Response.Step.Name, helpers.MustMarshal(t, idOK))

	resp, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"x-auth-methods#password": jx.Raw(`"` + identifierScopePassword + `"`),
		}),
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: mustExtractZflow(t, idOK.SetCookie)})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, resp, helpers.MustMarshal(t, resp))
	pwOK := resp.(*api.SubmitFlowStepOK)
	require.Equal(t, "done", pwOK.Response.Step.Name)
	token, ok := pwOK.Response.HandoffToken.Get()
	require.True(t, ok, "expected a handoff token")
	require.NotEmpty(t, token)
}

// TestIdentifierLookupScopedToBoundSchema: another schema holds the same
// email, team-unique and undesignated. The flow bound to the first schema
// still finds exactly its own user.
func TestIdentifierLookupScopedToBoundSchema(t *testing.T) {
	f := newIdentifierScopeFixture(t)
	schemaA := f.createSchema(t, "https://scope-a.example.com/schemas/user.json", "scope-a-user", true, "project")
	schemaB := f.createSchema(t, "https://scope-b.example.com/schemas/user.json", "scope-b-user", false, "team")
	const email = "shared@example.com"
	f.createUser(t, schemaA, email, domain.AttributeUniquenessProject)
	f.createUser(t, schemaB, email, domain.AttributeUniquenessTeam)

	f.signIn(t, passwordLoginFlowDefinition(schemaA), email)
}

// TestIdentifierLookupIgnoresOtherSchema: the email is held only by a user of
// another schema, so the flow's lookup finds nobody.
func TestIdentifierLookupIgnoresOtherSchema(t *testing.T) {
	f := newIdentifierScopeFixture(t)
	schemaA := f.createSchema(t, "https://scope-a.example.com/schemas/user.json", "scope-a-user", true, "project")
	schemaB := f.createSchema(t, "https://scope-b.example.com/schemas/user.json", "scope-b-user", false, "team")
	const email = "elsewhere@example.com"
	f.createUser(t, schemaB, email, domain.AttributeUniquenessTeam)

	_, idOK := f.submitIdentifier(t, passwordLoginFlowWithNotFoundFlowDefinition(schemaA), email)
	require.Equal(t, "not_found", idOK.Response.Step.Name, "a user of another schema must not be found: %s", helpers.MustMarshal(t, idOK))
}

// TestIdentifierLookupSpansSchemaRevisions: a user created under revision 1
// signs in through a flow that runs on revision 2 (#1507).
func TestIdentifierLookupSpansSchemaRevisions(t *testing.T) {
	f := newIdentifierScopeFixture(t)
	const objectType = "scope-revisioned-user"
	revision := func(n int, extra ...string) string {
		return f.createSchema(t, fmt.Sprintf("https://scope-revisioned.example.com/schemas/user-v%d.json", n), objectType, true, "project", extra...)
	}
	first := revision(1)
	const email = "revisioned@example.com"
	f.createUser(t, first, email, domain.AttributeUniquenessProject)
	revision(2, "nickname")

	// Named by objectType, the flow runs on the newest revision.
	f.signIn(t, passwordLoginFlowDefinition(objectType), email)
}
