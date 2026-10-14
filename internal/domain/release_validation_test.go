package domain_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// humanUserDocument carries the email field the login flow collects;
// humanUserWithoutEmail is a revision of the same handle that dropped it.
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
)

func loginFlowRevision() domain.ReleaseRevision {
	return domain.ReleaseRevision{
		Pointer: domain.ReleasePointer{
			Kind: domain.ReleasePointerKindFlowDefinition, Handle: "default-login", RevisionID: "flowdef_1",
		},
		FlowDefinition: &domain.FlowDefinition{
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
		},
	}
}

func schemaRevision(document []byte) domain.ReleaseRevision {
	return domain.ReleaseRevision{
		Pointer: domain.ReleasePointer{Kind: domain.ReleasePointerKindSchema, Handle: "human-user", RevisionID: "sch_1"},
		Schema:  &domain.JSONSchema{ObjectType: new("human-user"), Schema: document},
	}
}

func TestValidateRelease(t *testing.T) {
	t.Parallel()

	err := domain.ValidateRelease([]domain.ReleaseRevision{loginFlowRevision(), schemaRevision(humanUserDocument)})
	assert.NoError(t, err)
}

func TestValidateReleaseUnresolvedUserSchema(t *testing.T) {
	t.Parallel()

	err := domain.ValidateRelease([]domain.ReleaseRevision{loginFlowRevision()})
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseUnresolvedReference().Code, domErr.Code)
	assert.Equal(t, "flow_definition default-login: user_schema human-user not found", domErr.Message)
}

// A handle of another kind does not resolve the reference: a flow named
// human-user is not the schema.
func TestValidateReleaseMatchesKind(t *testing.T) {
	t.Parallel()

	sameName := loginFlowRevision()
	sameName.Pointer.Handle = "human-user"

	err := domain.ValidateRelease([]domain.ReleaseRevision{loginFlowRevision(), sameName})
	assert.ErrorIs(t, err, domain.ErrReleaseUnresolvedReference())
}

// The flow was saved against a revision that had email; the release pairs
// it with one that dropped it.
func TestValidateReleaseFlowMustFitItsSchema(t *testing.T) {
	t.Parallel()

	err := domain.ValidateRelease([]domain.ReleaseRevision{loginFlowRevision(), schemaRevision(humanUserWithoutEmail)})
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseInvalid(nil, nil).Code, domErr.Code)
	assert.Equal(t, "flow_definition default-login: does not fit user_schema human-user revision sch_1", domErr.Message)
	assert.NotEmpty(t, domErr.Details, "the details carry the flow validator's reason")
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionInvalid(nil, nil))
}
