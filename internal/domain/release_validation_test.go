package domain_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func loginFlowRevision() domain.ReleaseRevision {
	return domain.ReleaseRevision{
		Pointer: domain.ReleasePointer{
			Kind: domain.ReleasePointerKindFlowDefinition, Handle: "default-login", RevisionID: "flowdef_1",
		},
		FlowDefinition: &domain.FlowDefinition{ID: "flowdef_1", Name: "default-login", UserSchema: "human-user"},
	}
}

func schemaRevision(handle string) domain.ReleaseRevision {
	return domain.ReleaseRevision{
		Pointer: domain.ReleasePointer{Kind: domain.ReleasePointerKindSchema, Handle: handle, RevisionID: "sch_1"},
		Schema:  &domain.JSONSchema{ObjectType: new(handle)},
	}
}

func TestValidateReleaseClosedReferences(t *testing.T) {
	t.Parallel()

	err := domain.ValidateRelease([]domain.ReleaseRevision{
		loginFlowRevision(),
		schemaRevision("human-user"),
	})
	assert.NoError(t, err)
}

func TestValidateReleaseUnresolvedReference(t *testing.T) {
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
	sameName.Pointer.Handle, sameName.FlowDefinition.Name = "human-user", "human-user"

	err := domain.ValidateRelease([]domain.ReleaseRevision{loginFlowRevision(), sameName})
	assert.ErrorIs(t, err, domain.ErrReleaseUnresolvedReference())
}
