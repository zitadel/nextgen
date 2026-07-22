package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestIsSensitiveProperty(t *testing.T) {
	t.Parallel()

	assert.False(t, domain.IsSensitiveProperty(nil))
	assert.False(t, domain.IsSensitiveProperty(map[string]any{}))
	assert.False(t, domain.IsSensitiveProperty(map[string]any{"x-sensitive": false}))
	assert.True(t, domain.IsSensitiveProperty(map[string]any{"x-sensitive": true}))
}
