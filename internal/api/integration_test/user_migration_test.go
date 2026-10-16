//go:build postgres_integration || spanner_integration

package integration_test

import (
	"fmt"
	"maps"
	"testing"

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

	// asJSON round-trips v through JSON, so a fixture and a decoded response
	// compare equal regardless of Go's numeric types.
	asJSON := func(t *testing.T, v any) map[string]any {
		t.Helper()
		return *helpers.MustUnmarshal[map[string]any](t, []byte(helpers.MustMarshal(t, v)))
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
			assert.Equal(t, asJSON(t, wantAttributes), asJSON(t, user.Attributes))
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
		assert.Equal(t, asJSON(t, wantAttributes), asJSON(t, got.(*api.User).Attributes))
	}

	tcs := []struct {
		name       string
		objectType string
		v1, v2     map[string]any
		stored     map[string]any
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
			name:       "add an optional attribute",
			objectType: "migration-add-optional",
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
			name:       "relax validation",
			objectType: "migration-relax",
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
			name:       "add a required attribute",
			objectType: "migration-add-required",
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
			name:       "tighten validation",
			objectType: "migration-tighten",
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
			name:       "rename an attribute",
			objectType: "migration-rename",
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
			name:       "remove an attribute",
			objectType: "migration-remove",
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
			name:       "change an attribute's type",
			objectType: "migration-change-type",
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

			v1 := createRevision(t, tc.objectType, 1, tc.v1)
			v2 := createRevision(t, tc.objectType, 2, tc.v2)
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
	// change, but nothing refuses it today: the target only has to accept the
	// resulting attributes. #1507 §4 ("Restrict unsupported migrations")
	// narrows what a migration may change; when that lands this case flips to
	// the refusal it decides on.
	t.Run("another object type is not refused", func(t *testing.T) {
		t.Parallel()

		properties := map[string]any{
			"properties": map[string]any{"givenName": map[string]any{"type": "string"}},
		}
		from := createRevision(t, "migration-cross-type-from", 1, properties)
		to := createRevision(t, "migration-cross-type-to", 1, properties)
		userID := createUser(t, from, map[string]any{"givenName": "Ada"})

		assertUser(t, patch(t, userID, to, nil), userID, to, map[string]any{"givenName": "Ada"})
	})
}
