package deployment

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var t0 = time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC)

func TestNewestBreaksTiesOnID(t *testing.T) {
	assert.Nil(t, Newest(nil))

	rows := []TargetRow{
		{DeploymentID: "dep_a", Origin: "https://app.acme.com", DeployedAt: t0},
		{DeploymentID: "dep_c", Origin: "https://www.acme.com", DeployedAt: t0.Add(-time.Second)},
		{DeploymentID: "dep_b", Origin: "https://git.acme.com", DeployedAt: t0},
	}
	assert.Equal(t, "dep_b", Newest(rows).DeploymentID)
}

func TestAllServe(t *testing.T) {
	newest := []TargetRow{
		{Origin: "https://app.acme.com", ReleaseID: "rel_a"},
		{Origin: "https://www.acme.com", ReleaseID: "rel_a"},
	}
	assert.True(t, AllServe(newest, []string{"https://app.acme.com", "https://www.acme.com"}, "rel_a"))
	assert.False(t, AllServe(newest, []string{"https://app.acme.com"}, "rel_b"))
	assert.False(t, AllServe(newest, []string{"https://app.acme.com", "https://new.acme.com"}, "rel_a"),
		"a target that serves nothing is not served")
}

// A clock that stepped back behind the newest deployment still stamps after
// it, so the later deploy stays the newer one.
func TestStampNeverPrecedesTheSupersededDeployment(t *testing.T) {
	assert.Nil(t, StampFloor(nil))

	newest := &TargetRow{DeployedAt: t0}
	floor := StampFloor(newest)
	require.NotNil(t, floor)

	assert.Equal(t, t0.Add(time.Microsecond), Stamp(t0.Add(-time.Hour), floor))
	assert.Equal(t, t0.Add(time.Minute), Stamp(t0.Add(time.Minute+time.Nanosecond), floor),
		"a later clock wins, truncated to the microsecond every dialect keeps")
	assert.Equal(t, t0, Stamp(t0, nil))
}
