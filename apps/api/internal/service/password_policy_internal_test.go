package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// Bind coerces integer settings to int64, so a bound of another type cannot
// come out of a successful bind today. If one ever does, it must not read as
// an unset rule: that would drop the minimum and let a short password through.
func TestIntSetting(t *testing.T) {
	v, set, err := intSetting(map[string]any{"min_length": int64(12)}, "min_length")
	require.NoError(t, err)
	assert.True(t, set)
	assert.Equal(t, int64(12), v)

	_, set, err = intSetting(map[string]any{}, "min_length")
	require.NoError(t, err)
	assert.False(t, set, "a missing setting is an unset rule")

	_, _, err = intSetting(map[string]any{"min_length": "12"}, "min_length")
	assert.ErrorIs(t, err, domain.ErrInternal(nil), "a present setting of the wrong type fails closed")
}
