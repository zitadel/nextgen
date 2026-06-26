package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// fakeFlowUserWriter captures the [domain.CreateUser] the handler hands to
// the repository so tests can inspect attribute shape and uniqueness scopes.
type fakeFlowUserWriter struct {
	created *domain.CreateUser
	err     error
	calls   int
}

func (f *fakeFlowUserWriter) Create(_ context.Context, _ database.QueryExecutor, u *domain.CreateUser) error {
	f.calls++
	if f.err != nil {
		return f.err
	}
	f.created = u
	return nil
}

func attrByKey(t *testing.T, attrs []*domain.CreateAttribute, key string) *domain.CreateAttribute {
	t.Helper()
	for _, a := range attrs {
		if a.Key == key {
			return a
		}
	}
	t.Fatalf("attribute %q not found in %d collected attributes", key, len(attrs))
	return nil
}

func provisionalState(t *testing.T, collected map[string]any) *domain.FlowState {
	t.Helper()
	return &domain.FlowState{
		ProjectID:     "proj_1",
		UserSchemaURL: "https://example.test/schema.json",
		FlowProgress: domain.FlowProgress{
			CollectedData: domain.CollectedFlowData{
				UserData: collected,
			},
		},
	}
}

func registrationResolved() domain.FlowResolvedFields {
	return domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier, Unique: domain.AttributeUniquenessUnspecified},
			{Name: "givenName"},
			{Name: "familyName"},
			{Name: "dateOfBirth"},
			{Name: "maritalStatus"},
			{Name: "newsletterOptIn"},
		},
	}
}

func TestFlowCreateUserForPasskey_WritesEveryCollectedSchemaField(t *testing.T) {
	writer := &fakeFlowUserWriter{}
	h := service.NewFlowCreateUserForPasskeyHandler(writer)

	collected := map[string]any{
		"email":           "alice@example.com",
		"givenName":       "Alice",
		"familyName":      "Doe",
		"dateOfBirth":     "1990-01-02",
		"maritalStatus":   "single",
		"newsletterOptIn": true,
	}
	state := provisionalState(t, collected)
	resolved := registrationResolved()

	err := h.CreateProvisionalUser(t.Context(), nil, "user_provisional", state, resolved)
	require.NoError(t, err)
	require.NotNil(t, writer.created)

	got := writer.created
	assert.Equal(t, "proj_1", got.ProjectID)
	assert.Equal(t, "https://example.test/schema.json", got.SchemaURL)
	assert.Equal(t, "user_provisional", got.ID)
	require.Len(t, got.Attributes, len(collected), "every collected field must be written as an attribute")

	// Identifier gets the team-level uniqueness fallback.
	assert.Equal(t, domain.AttributeUniquenessTeam, attrByKey(t, got.Attributes, "email").UniqueScope)

	// Non-identifier fields keep AttributeUniquenessUnspecified.
	for _, key := range []string{"givenName", "familyName", "dateOfBirth", "maritalStatus", "newsletterOptIn"} {
		assert.Equal(t, domain.AttributeUniquenessUnspecified, attrByKey(t, got.Attributes, key).UniqueScope, "field %q", key)
	}
}

func TestFlowCreateUserForPasskey_IdentifierUniquenessHonorsSchemaScope(t *testing.T) {
	writer := &fakeFlowUserWriter{}
	h := service.NewFlowCreateUserForPasskeyHandler(writer)

	collected := map[string]any{"email": "alice@example.com"}
	state := provisionalState(t, collected)
	resolved := domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier, Unique: domain.AttributeUniquenessProject},
		},
	}

	err := h.CreateProvisionalUser(t.Context(), nil, "user_1", state, resolved)
	require.NoError(t, err)
	require.NotNil(t, writer.created)

	// Schema-pinned scope wins over the identifier fallback.
	assert.Equal(t, domain.AttributeUniquenessProject, attrByKey(t, writer.created.Attributes, "email").UniqueScope)
}

func TestFlowCreateUserForPasskey_MissingIdentifierIsIntegrityError(t *testing.T) {
	writer := &fakeFlowUserWriter{}
	h := service.NewFlowCreateUserForPasskeyHandler(writer)

	state := provisionalState(t, map[string]any{"givenName": "Alice"})
	resolved := domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier},
			{Name: "givenName"},
		},
	}

	err := h.CreateProvisionalUser(t.Context(), nil, "user_1", state, resolved)
	assert.ErrorIs(t, err, domain.ErrIntegrity)
	assert.Equal(t, 0, writer.calls, "must not call the writer when the identifier invariant fails")
}

func TestFlowCreateUserForPasskey_SkipsCollectedKeysNotInResolvedFields(t *testing.T) {
	writer := &fakeFlowUserWriter{}
	h := service.NewFlowCreateUserForPasskeyHandler(writer)

	collected := map[string]any{
		"email":      "alice@example.com",
		"strayValue": "should be dropped",
	}
	state := provisionalState(t, collected)
	resolved := domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier},
		},
	}

	err := h.CreateProvisionalUser(t.Context(), nil, "user_1", state, resolved)
	require.NoError(t, err)
	require.NotNil(t, writer.created)
	require.Len(t, writer.created.Attributes, 1)
	assert.Equal(t, "email", writer.created.Attributes[0].Key)
}

func TestFlowCreateUserForPasskey_SkipsPasswordChallengeFieldDefensively(t *testing.T) {
	// Password challenge fields land in CollectedData.AuthMethods.Password,
	// not UserData. This test pins the defensive skip in case a future
	// caller routes a password-shaped field through UserData by mistake.
	writer := &fakeFlowUserWriter{}
	h := service.NewFlowCreateUserForPasskeyHandler(writer)

	collected := map[string]any{
		"email":               "alice@example.com",
		"x-auth-methods#pwd":  "leaked plaintext",
	}
	state := provisionalState(t, collected)
	resolved := domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{Name: "email", Challenge: domain.FlowFieldChallengeIdentifier},
			{Name: "x-auth-methods#pwd", Challenge: domain.FlowFieldChallengePassword},
		},
	}

	err := h.CreateProvisionalUser(t.Context(), nil, "user_1", state, resolved)
	require.NoError(t, err)
	require.NotNil(t, writer.created)
	require.Len(t, writer.created.Attributes, 1)
	assert.Equal(t, "email", writer.created.Attributes[0].Key)
}

func TestFlowCreateUserForPasskey_IdempotentOnUniqueError(t *testing.T) {
	writer := &fakeFlowUserWriter{err: &database.UniqueError{}}
	h := service.NewFlowCreateUserForPasskeyHandler(writer)

	collected := map[string]any{"email": "alice@example.com"}
	state := provisionalState(t, collected)

	err := h.CreateProvisionalUser(t.Context(), nil, "user_1", state, registrationResolved())
	assert.NoError(t, err, "a prior on_success having created the row must not surface as an error")
	assert.Equal(t, 1, writer.calls)
}

func TestFlowCreateUserForPasskey_PropagatesNonUniqueWriterError(t *testing.T) {
	sentinel := errors.New("repo exploded")
	writer := &fakeFlowUserWriter{err: sentinel}
	h := service.NewFlowCreateUserForPasskeyHandler(writer)

	collected := map[string]any{"email": "alice@example.com"}
	state := provisionalState(t, collected)

	err := h.CreateProvisionalUser(t.Context(), nil, "user_1", state, registrationResolved())
	assert.ErrorIs(t, err, sentinel)
}
