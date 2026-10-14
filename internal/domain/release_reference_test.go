package domain_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

var (
	humanUserSchema = domain.ReleasePointer{
		Kind: domain.ReleasePointerKindSchema, Handle: "human-user", RevisionID: "sch_1",
	}
	userSchemaRef = domain.ReleaseReference{
		Kind: domain.ReleasePointerKindSchema, Field: "user_schema", Handle: "human-user",
	}
)

func loginFlow() domain.ReleaseReferrer {
	return domain.ReleaseReferrer{
		Pointer: domain.ReleasePointer{
			Kind: domain.ReleasePointerKindFlowDefinition, Handle: "default-login", RevisionID: "flowdef_1",
		},
		References: domain.FlowDefinitionReleaseReferences(&domain.FlowDefinition{UserSchema: "human-user"}),
	}
}

func TestCloseReleaseReferencesIncludedHandle(t *testing.T) {
	t.Parallel()

	pointers, err := domain.CloseReleaseReferences(
		[]domain.ReleaseReferrer{loginFlow(), {Pointer: humanUserSchema}}, nil)
	require.NoError(t, err)
	assert.Equal(t, []domain.ReleasePointer{loginFlow().Pointer, humanUserSchema}, pointers)
}

func TestCloseReleaseReferencesMissingHandle(t *testing.T) {
	t.Parallel()

	_, err := domain.CloseReleaseReferences([]domain.ReleaseReferrer{loginFlow()}, nil)
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseUnresolvedReference().Code, domErr.Code)
	assert.Equal(t, "flow_definition default-login: user_schema human-user not found", domErr.Message)
}

// A handle of another kind does not resolve the reference: a flow named
// human-user is not the schema.
func TestCloseReleaseReferencesMatchesKind(t *testing.T) {
	t.Parallel()

	sameName := domain.ReleaseReferrer{Pointer: domain.ReleasePointer{
		Kind: domain.ReleasePointerKindFlowDefinition, Handle: "human-user", RevisionID: "flowdef_2",
	}}
	_, err := domain.CloseReleaseReferences([]domain.ReleaseReferrer{loginFlow(), sameName}, nil)
	assert.True(t, errors.Is(err, domain.ErrReleaseUnresolvedReference()))
}

// A lookup adds what the release lacks, once per handle however many revisions
// reference it.
func TestCloseReleaseReferencesLookupAdds(t *testing.T) {
	t.Parallel()

	other := loginFlow()
	other.Pointer.Handle, other.Pointer.RevisionID = "b2b-login", "flowdef_2"

	var asked []domain.ReleaseReference
	pointers, err := domain.CloseReleaseReferences(
		[]domain.ReleaseReferrer{loginFlow(), other},
		func(ref domain.ReleaseReference) (*domain.ReleaseReferrer, error) {
			asked = append(asked, ref)
			return &domain.ReleaseReferrer{Pointer: humanUserSchema}, nil
		})
	require.NoError(t, err)
	assert.Equal(t, []domain.ReleaseReference{userSchemaRef}, asked)
	assert.Equal(t, []domain.ReleasePointer{loginFlow().Pointer, other.Pointer, humanUserSchema}, pointers)
}

// A revision the lookup adds has its own references checked.
func TestCloseReleaseReferencesChecksLookedUpRevision(t *testing.T) {
	t.Parallel()

	referencesFlow := domain.ReleaseReferrer{
		Pointer:    domain.ReleasePointer{Kind: domain.ReleasePointerKindBranding, Handle: "default", RevisionID: "brnd_1"},
		References: []domain.ReleaseReference{{Kind: domain.ReleasePointerKindFlowDefinition, Field: "flow", Handle: "default-login"}},
	}
	_, err := domain.CloseReleaseReferences([]domain.ReleaseReferrer{referencesFlow},
		func(ref domain.ReleaseReference) (*domain.ReleaseReferrer, error) {
			if ref.Kind == domain.ReleasePointerKindFlowDefinition {
				flow := loginFlow()
				return &flow, nil
			}
			return nil, nil
		})
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, "flow_definition default-login: user_schema human-user not found", domErr.Message)
}

func TestCloseReleaseReferencesLookupError(t *testing.T) {
	t.Parallel()

	boom := errors.New("boom")
	_, err := domain.CloseReleaseReferences([]domain.ReleaseReferrer{loginFlow()},
		func(domain.ReleaseReference) (*domain.ReleaseReferrer, error) { return nil, boom })
	assert.ErrorIs(t, err, boom)
}
