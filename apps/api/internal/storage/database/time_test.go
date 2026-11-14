package database

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUTCOrNil(t *testing.T) {
	assert.Nil(t, UTCOrNil(nil))

	local := time.Date(2026, 10, 2, 16, 10, 0, 0, time.FixedZone("CEST", 2*60*60))
	got := UTCOrNil(&local)
	require.NotNil(t, got)
	assert.Equal(t, time.UTC, got.Location())
	assert.True(t, local.Equal(*got))
	assert.Equal(t, "CEST", local.Location().String(), "the argument is left as it was")
}
