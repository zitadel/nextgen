//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestPatchUserMigration walks every schema change the first iteration of
// schema evolution supports (#1507 §3) through PATCH /users/{user_id}: a user
// stored under revision 1 moves to revision 2 of the same logical schema. Where
// the change needs the caller's help, the migration without it is refused and
// leaves the user as it was; the same migration with the help is accepted.
func TestPatchUserMigration(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	// createRevision registers one revision of the logical schema objectType
	// and returns its URL. Every revision of a scenario shares the object type
	// and differs in $id, which is what makes them revisions of one schema
	// rather than two schemas.
	createRevision := func(t *testing.T, objectType string, rev int, body map[string]any) string {
		t.Helper()
		doc := map[string]any{
			"$id":            fmt.Sprintf("https://migration.example.com/schemas/%s-v%d.json", objectType, rev),
			"$schema":        "https://json-schema.org/draft/2020-12/schema",
			"title":          objectType,
			"metaSchema":     helpers.BuiltinSchemaBaseURL + "/user-schema.json",
			"kind":           "user-schema",
			"objectType":     objectType,
			"type":           "object",
			"x-auth-methods": map[string]any{"passkey": map[string]any{"enabled": true}},
		}
		maps.Copy(doc, body)
		return harness.CreateUserSchema(t, project, helpers.MustMarshal(t, doc))
	}

	createUser := func(t *testing.T, schemaURL string, attributes map[string]any) api.UserID {
		t.Helper()
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  schemaURL,
			Attributes: attributes,
		})
		require.NoError(t, err)
		return api.UserID(user.ID)
	}

	// patch sends schemaURL (when set) and attributes (when any) in one
	// request.
	patch := func(t *testing.T, userID api.UserID, schemaURL string, attributes map[string]any) api.PatchUserByIDRes {
		t.Helper()
		body := map[string]any{}
		if schemaURL != "" {
			body["schema"] = schemaURL
		}
		if len(attributes) > 0 {
			body["attributes"] = attributes
		}
		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, body), api.PatchUserByIDParams{UserID: userID})
		require.NoError(t, err)
		return resp
	}

	// assertUser checks the user both in a response and in a fresh read: the
	// response is not the only witness, the stored user has to agree.
	assertUser := func(t *testing.T, resp api.PatchUserByIDRes, userID api.UserID, wantSchema string, wantAttributes map[string]any) {
		t.Helper()
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
		got, err := client.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: userID})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, got, helpers.MustMarshal(t, got))

		for _, user := range []*api.User{resp.(*api.User), got.(*api.User)} {
			assert.Equal(t, userID, user.ID, "migration keeps the user's identity")
			assert.Equal(t, wantSchema, user.Schema)
			assert.JSONEq(t, helpers.MustMarshal(t, wantAttributes), helpers.MustMarshal(t, user.Attributes))
		}
	}

	// assertRefused checks that the target schema refused the result, as
	// opposed to any other 400, and that the user is exactly as stored.
	assertRefused := func(t *testing.T, resp api.PatchUserByIDRes, userID api.UserID, wantSchema string, wantAttributes map[string]any) {
		t.Helper()
		// The response type is what pins the 400: errorResponseParts reports a
		// declared status as 0.
		require.IsType(t, &api.PatchUserByIDBadRequest{}, resp, helpers.MustMarshal(t, resp))
		_, code, message, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, domain.ErrUserInvalid().Code, code)
		assert.Contains(t, message, "not valid according to schema")

		got, err := client.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: userID})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, got, helpers.MustMarshal(t, got))
		assert.Equal(t, wantSchema, got.(*api.User).Schema)
		assert.JSONEq(t, helpers.MustMarshal(t, wantAttributes), helpers.MustMarshal(t, got.(*api.User).Attributes))
	}

	tcs := []struct {
		name   string
		v1, v2 map[string]any
		stored map[string]any
		// wantRefusal marks a change that needs the caller's help: moving to
		// v2 with refusal as the attribute patch (none: the schema reference
		// alone) is refused before accepted is tried.
		wantRefusal bool
		refusal     map[string]any
		// accepted is the attribute patch that makes the move succeed; nil
		// sends the schema reference alone.
		accepted map[string]any
		want     map[string]any
		// afterwards is an attribute patch, without a schema reference, that
		// only v2 allows. It proves the migrated user is validated against v2
		// when the migration itself sent nothing v1 would have refused.
		afterwards     map[string]any
		wantAfterwards map[string]any
	}{
		{
			name: "add an optional attribute",
			v1: map[string]any{
				"additionalProperties": false,
				"properties":           map[string]any{"givenName": map[string]any{"type": "string"}},
			},
			v2: map[string]any{
				"additionalProperties": false,
				"properties": map[string]any{
					"givenName":         map[string]any{"type": "string"},
					"preferredLanguage": map[string]any{"type": "string"},
				},
			},
			stored:         map[string]any{"givenName": "Ada"},
			want:           map[string]any{"givenName": "Ada"},
			afterwards:     map[string]any{"preferredLanguage": "en"},
			wantAfterwards: map[string]any{"givenName": "Ada", "preferredLanguage": "en"},
		},
		{
			name: "relax validation",
			v1: map[string]any{
				"required": []string{"givenName", "nickname"},
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string", "maxLength": 5},
					"nickname":  map[string]any{"type": "string"},
				},
			},
			v2: map[string]any{
				"required": []string{"givenName"},
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string", "maxLength": 50},
					"nickname":  map[string]any{"type": "string"},
				},
			},
			stored: map[string]any{"givenName": "Ada", "nickname": "ada"},
			want:   map[string]any{"givenName": "Ada", "nickname": "ada"},
			// Longer than v1 allows, and without the nickname v1 requires.
			afterwards:     map[string]any{"givenName": "Augusta Ada", "nickname": nil},
			wantAfterwards: map[string]any{"givenName": "Augusta Ada"},
		},
		{
			name: "add a required attribute",
			v1: map[string]any{
				"properties": map[string]any{"givenName": map[string]any{"type": "string"}},
			},
			v2: map[string]any{
				"required": []string{"country"},
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string"},
					"country":   map[string]any{"type": "string"},
				},
			},
			stored:      map[string]any{"givenName": "Ada"},
			wantRefusal: true,
			accepted:    map[string]any{"country": "CH"},
			want:        map[string]any{"givenName": "Ada", "country": "CH"},
		},
		{
			name: "tighten validation",
			v1: map[string]any{
				"properties": map[string]any{"country": map[string]any{"type": "string"}},
			},
			v2: map[string]any{
				"properties": map[string]any{
					"country": map[string]any{"type": "string", "enum": []string{"CH", "DE"}},
				},
			},
			stored:      map[string]any{"country": "Switzerland"},
			wantRefusal: true,
			accepted:    map[string]any{"country": "CH"},
			want:        map[string]any{"country": "CH"},
		},
		{
			name: "rename an attribute",
			v1: map[string]any{
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string"},
					"surname":   map[string]any{"type": "string"},
				},
			},
			v2: map[string]any{
				"additionalProperties": false,
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string"},
					"lastName":  map[string]any{"type": "string"},
				},
			},
			stored:      map[string]any{"givenName": "Ada", "surname": "Lovelace"},
			wantRefusal: true,
			// The new name alone is not enough: the old one is still stored
			// and the target disallows it.
			refusal:  map[string]any{"lastName": "Lovelace"},
			accepted: map[string]any{"lastName": "Lovelace", "surname": nil},
			want:     map[string]any{"givenName": "Ada", "lastName": "Lovelace"},
		},
		{
			name: "remove an attribute",
			v1: map[string]any{
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string"},
					"nickname":  map[string]any{"type": "string"},
				},
			},
			v2: map[string]any{
				"additionalProperties": false,
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string"},
				},
			},
			stored:      map[string]any{"givenName": "Ada", "nickname": "ada"},
			wantRefusal: true,
			accepted:    map[string]any{"nickname": nil},
			want:        map[string]any{"givenName": "Ada"},
		},
		{
			name: "change an attribute's type",
			v1: map[string]any{
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string"},
					"age":       map[string]any{"type": "string"},
				},
			},
			v2: map[string]any{
				"properties": map[string]any{
					"givenName": map[string]any{"type": "string"},
					"age":       map[string]any{"type": "integer"},
				},
			},
			// "36" is a number in all but type; Zitadel does not convert it.
			stored:      map[string]any{"givenName": "Ada", "age": "36"},
			wantRefusal: true,
			accepted:    map[string]any{"age": 36},
			want:        map[string]any{"givenName": "Ada", "age": 36},
		},
	}

	for _, tc := range tcs {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			objectType := "migration-" + helpers.RandString(8)
			v1 := createRevision(t, objectType, 1, tc.v1)
			v2 := createRevision(t, objectType, 2, tc.v2)
			userID := createUser(t, v1, tc.stored)

			if tc.wantRefusal {
				assertRefused(t, patch(t, userID, v2, tc.refusal), userID, v1, tc.stored)
			}

			assertUser(t, patch(t, userID, v2, tc.accepted), userID, v2, tc.want)

			if tc.afterwards != nil {
				assertUser(t, patch(t, userID, "", tc.afterwards), userID, v2, tc.wantAfterwards)
			}
		})
	}

	// Moving a user to a schema of another object type is not a revision
	// change, so it is refused even though the target would accept the
	// attributes (#1507 §4, "Restrict unsupported migrations").
	t.Run("another object type is refused", func(t *testing.T) {
		t.Parallel()

		properties := map[string]any{
			"properties": map[string]any{"givenName": map[string]any{"type": "string"}},
		}
		from := createRevision(t, "migration-cross-type-from", 1, properties)
		to := createRevision(t, "migration-cross-type-to", 1, properties)
		userID := createUser(t, from, map[string]any{"givenName": "Ada"})

		resp := patch(t, userID, to, nil)
		require.IsType(t, &api.PatchUserByIDBadRequest{}, resp, helpers.MustMarshal(t, resp))
		invalid := resp.(*api.PatchUserByIDBadRequest)
		assert.Equal(t, api.ErrorCode(domain.ErrUserInvalid().Code), invalid.Code)
		assert.JSONEq(t, `{
			"schema": "`+to+`",
			"object_type": "migration-cross-type-to",
			"current_schema": "`+from+`",
			"current_object_type": "migration-cross-type-from"
		}`, string(invalid.Details.Value["details"]))

		got, err := client.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: userID})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, got, helpers.MustMarshal(t, got))
		assert.Equal(t, from, got.(*api.User).Schema, "the user stays on its schema")
		assert.JSONEq(t, `{"givenName": "Ada"}`, helpers.MustMarshal(t, got.(*api.User).Attributes))
	})
}

// migrationObjectType is the objectType both revisions of the migration
// schema share.
const migrationObjectType = "migration-identity-user"

// TestPatchUserMigrationKeepsIdentity pins the other half of #1507: a patch
// that moves a user to another revision of its schema rewrites the attributes
// and nothing else. The id, created_at, the credentials, the team membership
// and the identity link all hang off the user id, which PATCH never touches,
// so the user signs in exactly as before.
//
// It builds on the SSO resolution fixture, so like those tests it runs
// sequentially for the Spanner emulator.
func TestPatchUserMigrationKeepsIdentity(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))

	// The second revision requires a property the first does not have, so the
	// migration has to change attributes to pass.
	revision := func(t *testing.T, required []string, properties string) string {
		t.Helper()
		return harness.CreateUserSchema(t, f.project, fmt.Sprintf(`{
			"title": "MigrationIdentityUser",
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"objectType": %q,
			"type": "object",
			"x-identifier": "email",
			"x-auth-methods": {"password": {"enabled": true}, "passkey": {"enabled": true}},
			"required": %s,
			"properties": {
				"email": {"type": "string", "x-unique": "project"},
				"nickname": {"type": "string"},
				%s
			}
		}`, helpers.BuiltinSchemaBaseURL, migrationObjectType, helpers.MustMarshal(t, required), properties))
	}
	initialSchema := revision(t, []string{"email"}, `"color": {"type": "string"}`)

	// One definition offers every method. It names the schema by objectType,
	// so flows run against its newest revision.
	definition := ssoLoginFlowDefinition(migrationObjectType)
	definition.Name = "migration-login"
	definition.Steps[0].Actions = append(definition.Steps[0].Actions,
		api.StepAction{Name: "passkey", Kind: api.StepActionKindPasskey})
	definition.Steps[0].Transitions.Value["passkey"] = api.FlowDefinitionStepTransitionsItem{Target: "done"}
	defResp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      f.projectID(),
		FlowDefinition: definition,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))
	f.definitionName = definition.Name

	// --- The user, with every kind of identity ---------------------------------
	const password = "correct-horse-battery-staple"
	userID := "user_" + helpers.RandString(8)
	email := helpers.RandString(8) + "@example.com"
	createAttemptUser(t, f.project, f.team, initialSchema, userID, map[string]string{
		"email":    email,
		"nickname": "Ada",
		"color":    "green",
	})
	setAttemptPassword(t, f.project, userID, password)

	rpOrigin, err := url.Parse(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	rp := virtualwebauthn.RelyingParty{ID: rpOrigin.Hostname(), Name: "Test", Origin: rpOrigin.String()}
	authenticator := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	// An ASCII credential id, so it is valid UTF-8 for a TEXT column.
	credential.ID = []byte("migration-cred-" + helpers.RandString(8))
	credential.Counter = 1
	authenticator.AddCredential(credential)
	require.NoError(t, harness.EnsureUserPasskeyFixture(t).Create(t.Context(), &domain.CreateUserPasskey{
		ProjectID:    f.project.ID,
		UserID:       userID,
		CredentialID: base64.RawURLEncoding.EncodeToString(credential.ID),
		PublicKey:    credential.Key.AttestationData(),
		AAGUID:       authenticator.Aaguid[:],
		Transports:   []string{},
		SignCount:    1,
	}))

	f.link(t, f.connection.ID, "sub-migrant", userID)

	stmts := harness.EnsureServiceDB(t).Statements()
	before, err := harness.EnsureUserFixture(t).GetByID(t.Context(), f.project.ID, userID)
	require.NoError(t, err)
	membershipBefore, err := stmts.GetTeamMembership(t.Context(), f.project.ID, f.team.ID, userID)
	require.NoError(t, err)
	linkBefore, err := f.linkFor(t, "sub-migrant")
	require.NoError(t, err)

	// --- The migration --------------------------------------------------------
	targetSchema := revision(t, []string{"email", "givenName"}, `
		"color": {"type": "string"},
		"givenName": {"type": "string"}`)
	req := &api.PatchUserRequest{}
	require.NoError(t, req.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
		"schema": targetSchema,
		"attributes": map[string]any{
			"givenName": "Ada",
			"nickname":  "Countess",
			"color":     nil,
		},
	}))))
	resp, err := f.client.PatchUserByID(t.Context(), req, api.PatchUserByIDParams{UserID: api.UserID(userID)})
	require.NoError(t, err)
	require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))

	// --- The user moved and changed -------------------------------------------
	after, err := harness.EnsureUserFixture(t).GetByID(t.Context(), f.project.ID, userID)
	require.NoError(t, err, "the user is still found under its id")
	require.Equal(t, targetSchema, after.SchemaURL, "the migration must have happened for the rest to mean anything")
	attributes, err := after.Attributes.ToMap()
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"email": email, "nickname": "Countess", "givenName": "Ada"}, attributes)

	// --- ...and kept its identity ---------------------------------------------
	assert.True(t, before.Metadata.CreatedAt.Equal(after.Metadata.CreatedAt),
		"created_at moved from %s to %s", before.Metadata.CreatedAt, after.Metadata.CreatedAt)

	membershipAfter, err := stmts.GetTeamMembership(t.Context(), f.project.ID, f.team.ID, userID)
	require.NoError(t, err, "the team membership is still there")
	assert.Equal(t, membershipBefore, membershipAfter)

	linkAfter, err := f.linkFor(t, "sub-migrant")
	require.NoError(t, err, "the identity link is still there")
	assert.Equal(t, linkBefore, linkAfter)

	t.Run("signs in with the password", func(t *testing.T) {
		attemptID := newAttempt(t, f.client, f.project)
		identified := verifyAttemptProof(t, f.client, attemptID, api.ChallengeMethodIdentifier, identifierProof(email))
		require.Equal(t, userID, identifiedUser(t, identified))
		passworded := verifyAttemptProof(t, f.client, attemptID, api.ChallengeMethodPassword, &api.VerifyChallengeRequest{
			OneOf: api.NewPasswordProofVerifyChallengeRequestSum(api.PasswordProof{Password: password}),
		})
		require.Contains(t, completedMethods(passworded), api.FactorMethodPassword)

		handoff, err := f.client.CreateHandoff(t.Context(), api.CreateHandoffParams{AttemptID: attemptID})
		require.NoError(t, err)
		require.IsType(t, &api.HandoffResponse{}, handoff, helpers.MustMarshal(t, handoff))
	})

	t.Run("signs in with the passkey", func(t *testing.T) {
		flow := f.startFlow(t, "")
		issued, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{Action: "passkey"},
			api.SubmitFlowStepParams{ID: flow.id, Zflow: flow.zflow, Origin: api.NewOptURI(*rpOrigin)})
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepOK{}, issued, helpers.MustMarshal(t, issued))
		issuedOK := issued.(*api.SubmitFlowStepOK)
		challenge, ok := issuedOK.Response.Step.Challenge.Get()
		require.True(t, ok, "the passkey action issues a challenge")
		challengeID, ok := challenge.ChallengeID.Get()
		require.True(t, ok, "the challenge carries its id")

		optionsJSON, err := json.Marshal(challenge.Options.Value)
		require.NoError(t, err)
		options, err := virtualwebauthn.ParseAssertionOptions(string(optionsJSON))
		require.NoError(t, err)
		var proof api.FlowSubmitRequestChallengeResponseProof
		require.NoError(t, json.Unmarshal([]byte(virtualwebauthn.CreateAssertionResponse(rp, authenticator, credential, *options)), &proof))

		verified, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
			Action: "passkey",
			ChallengeResponse: api.NewOptFlowSubmitRequestChallengeResponse(api.FlowSubmitRequestChallengeResponse{
				ChallengeID: api.NewOptString(challengeID),
				Method:      api.NewOptString("passkey"),
				Proof:       api.NewOptFlowSubmitRequestChallengeResponseProof(proof),
			}),
		}, api.SubmitFlowStepParams{ID: flow.id, Zflow: mustExtractZflow(t, issuedOK.SetCookie)})
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepOK{}, verified, helpers.MustMarshal(t, verified))
		assert.True(t, verified.(*api.SubmitFlowStepOK).Response.HandoffToken.Set, "a passkey sign-in hands off")
		userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, userID, userFactor.UserID)
	})

	t.Run("signs in with SSO", func(t *testing.T) {
		flow := f.startFlow(t, "")
		parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-migrant",
			map[string]any{"email": email}, map[string]bool{"email": true})

		requireAuthenticated(t, f.getStep(t, flow))
		userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, userID, userFactor.UserID, "the link resolves to the migrated user")
	})
}
