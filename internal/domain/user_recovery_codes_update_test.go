package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestRequireNonEmptyRecoveryCodes(t *testing.T) {
	t.Parallel()
	assert.ErrorIs(t, domain.RequireNonEmptyRecoveryCodes(nil), domain.ErrEmptyRecoveryCodes)
	assert.ErrorIs(t, domain.RequireNonEmptyRecoveryCodes([]string{}), domain.ErrEmptyRecoveryCodes)
	assert.NoError(t, domain.RequireNonEmptyRecoveryCodes([]string{"a"}))
}
