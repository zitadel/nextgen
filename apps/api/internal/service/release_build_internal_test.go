package service

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

// A resource's own refusal goes into the bag, even one that is a server fault
// elsewhere; a failure of the server bubbles, so a Spanner abort, reported as
// unavailable, is retried.
func TestIsBundleResourceFailure(t *testing.T) {
	t.Parallel()

	assert.True(t, isBundleResourceFailure(domain.ErrApplicationInvalid(nil, nil)))
	assert.True(t, isBundleResourceFailure(domain.ErrSchemaFetchFailed("failed to fetch user schema", nil)),
		"a flow whose schema cannot be fetched is the bundle's entry, not a 500")
	assert.False(t, isBundleResourceFailure(domain.ErrInternal(nil)))
	assert.False(t, isBundleResourceFailure(domain.ErrUnavailable()))
	assert.False(t, isBundleResourceFailure(errors.New("raw storage error")))
}
