package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthzListUnrestrictedClearsInheritedFilter(t *testing.T) {
	t.Parallel()

	filter := AuthzListFilter{
		AuthzCheckParams: domain.AuthzCheckParams{
			ProjectID: "proj_1", ObjectType: "project", Relation: "viewer",
		},
		ResourceKind: domain.ResourceKindTeam,
	}
	ctx := WithAuthzListFilter(context.Background(), filter)
	got, ok := AuthzListFilterFromContext(ctx)
	require.True(t, ok)
	assert.Equal(t, domain.ResourceKindTeam, got.ResourceKind)

	nested := WithAuthzListUnrestricted(ctx)
	_, ok = AuthzListFilterFromContext(nested)
	assert.False(t, ok, "unrestricted wrap must ignore the inherited filter")
	assert.True(t, AuthzListUnrestricted(nested))
	_, ok = AuthzListFilterFromContext(ctx)
	assert.True(t, ok, "parent context still has the filter")
}

func TestAuthzListSkipOnceIsConsumedOnce(t *testing.T) {
	t.Parallel()

	ctx := WithAuthzListSkipOnce(context.Background())
	assert.True(t, AuthzListSkipOncePending(ctx))
	assert.True(t, ConsumeAuthzListSkipOnce(ctx))
	assert.False(t, AuthzListSkipOncePending(ctx))
	assert.False(t, ConsumeAuthzListSkipOnce(ctx), "second consume must fail closed")
}

func TestAuthzListUnrestrictedDoesNotConsumeSkipOnce(t *testing.T) {
	t.Parallel()

	ctx := WithAuthzListSkipOnce(context.Background())
	nested := WithAuthzListUnrestricted(ctx)
	assert.True(t, AuthzListUnrestricted(nested))
	assert.True(t, AuthzListSkipOncePending(nested), "nested unrestricted must not eat Allow's skip")
}
