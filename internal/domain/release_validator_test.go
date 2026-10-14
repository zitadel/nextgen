package domain_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

var (
	humanUserDocument = []byte(`{
  "type": "object",
  "x-identifier": "email",
  "x-auth-methods": {"password": {"enabled": true}},
  "properties": {"email": {"type": "string", "format": "email", "x-unique": "team"}}
}`)
	humanUserWithoutEmail = []byte(`{
  "type": "object",
  "x-auth-methods": {"password": {"enabled": true}},
  "properties": {"name": {"type": "string"}}
}`)
	humanUserWithGoogle = []byte(`{
  "type": "object",
  "x-identifier": "email",
  "x-auth-methods": {"password": {"enabled": true}, "sso": {"enabled": true, "providers": ["google"]}},
  "properties": {"email": {"type": "string", "format": "email", "x-unique": "team"}}
}`)
)

func loginFlow() *domain.FlowDefinition {
	return &domain.FlowDefinition{
		ID:         "flowdef_1",
		Name:       "default-login",
		UserSchema: "human-user",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:        "identify",
				Fields:      []domain.Field{"email"},
				Actions:     []domain.FlowStepAction{{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true}},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "done"}},
			},
			{Name: "done", Complete: new(domain.FlowStepCompleteRedirect)},
		},
	}
}

func humanUser(document []byte) *domain.JSONSchema {
	return &domain.JSONSchema{URL: "sch_1", ObjectType: new("human-user"), Schema: document}
}

var google = &domain.IDPConnection{ID: "idp_1", Slug: "google", RevisionID: "idprev_1"}

func requireUnresolved(t *testing.T, err error, message string) {
	t.Helper()
	require.Error(t, err)
	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseUnresolvedReference().Code, domErr.Code)
	assert.Equal(t, message, domErr.Message)
}

func TestReleaseContentPointers(t *testing.T) {
	t.Parallel()

	content := domain.ReleaseContent{
		Schemas:         []*domain.JSONSchema{humanUser(humanUserDocument)},
		FlowDefinitions: []*domain.FlowDefinition{loginFlow()},
		IDPConnections:  []*domain.IDPConnection{google},
		Branding:        &domain.Branding{ID: "brnd_1"},
	}
	assert.Equal(t, []domain.ReleasePointer{
		{Kind: domain.ReleasePointerKindSchema, Handle: "human-user", RevisionID: "sch_1"},
		{Kind: domain.ReleasePointerKindFlowDefinition, Handle: "default-login", RevisionID: "flowdef_1"},
		{Kind: domain.ReleasePointerKindIDP, Handle: "google", RevisionID: "idprev_1"},
		{Kind: domain.ReleasePointerKindBranding, Handle: "default", RevisionID: "brnd_1"},
	}, content.Pointers())
}

func TestValidateRelease(t *testing.T) {
	t.Parallel()

	err := domain.ValidateRelease(domain.ReleaseContent{
		Schemas:         []*domain.JSONSchema{humanUser(humanUserDocument)},
		FlowDefinitions: []*domain.FlowDefinition{loginFlow()},
	})
	assert.NoError(t, err)
}

func TestValidateReleaseUnresolvedUserSchema(t *testing.T) {
	t.Parallel()

	err := domain.ValidateRelease(domain.ReleaseContent{FlowDefinitions: []*domain.FlowDefinition{loginFlow()}})
	requireUnresolved(t, err, "flow_definition default-login: user_schema human-user not found")
}

// A flow named human-user is not the schema.
func TestValidateReleaseMatchesKind(t *testing.T) {
	t.Parallel()

	sameName := loginFlow()
	sameName.Name = "human-user"

	err := domain.ValidateRelease(domain.ReleaseContent{FlowDefinitions: []*domain.FlowDefinition{loginFlow(), sameName}})
	assert.ErrorIs(t, err, domain.ErrReleaseUnresolvedReference())
}

func TestValidateReleaseUnresolvedFlowSSOProvider(t *testing.T) {
	t.Parallel()

	flow := loginFlow()
	flow.Steps[0].SSOProviders = []string{"google"}

	err := domain.ValidateRelease(domain.ReleaseContent{
		Schemas:         []*domain.JSONSchema{humanUser(humanUserDocument)},
		FlowDefinitions: []*domain.FlowDefinition{flow},
	})
	requireUnresolved(t, err, "flow_definition default-login: step identify sso_providers google not found")
}

func TestValidateReleaseSchemaSSOProviders(t *testing.T) {
	t.Parallel()

	content := domain.ReleaseContent{Schemas: []*domain.JSONSchema{humanUser(humanUserWithGoogle)}}
	requireUnresolved(t, domain.ValidateRelease(content),
		"schema human-user: x-auth-methods.sso.providers google not found")

	content.IDPConnections = []*domain.IDPConnection{google}
	assert.NoError(t, domain.ValidateRelease(content))
}

func TestValidateReleaseFlowMustFitItsSchema(t *testing.T) {
	t.Parallel()

	err := domain.ValidateRelease(domain.ReleaseContent{
		Schemas:         []*domain.JSONSchema{humanUser(humanUserWithoutEmail)},
		FlowDefinitions: []*domain.FlowDefinition{loginFlow()},
	})
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseInvalid(nil, nil).Code, domErr.Code)
	assert.Equal(t, "flow_definition default-login: invalid", domErr.Message)
	assert.NotEmpty(t, domErr.Details, "the details carry the flow validator's reason")
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(nil, nil))
}
