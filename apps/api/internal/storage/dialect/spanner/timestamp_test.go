//go:build spanner_integration

package spanner

import (
	"testing"
	"time"

	"cloud.google.com/go/spanner"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The dialect does not normalize a scanned TIMESTAMP: Spanner sends RFC 3339 in
// UTC, so the client's time.Parse already yields time.UTC. This pins that, so a
// client upgrade decoding into a fixed or local zone fails here rather than
// serving a non-UTC offset through the shared encoders.
func TestClient_scansTimestampInUTC(t *testing.T) {
	var got time.Time
	err := newClientDB(testClient.client).Query(t.Context(),
		spanner.Statement{SQL: "SELECT CURRENT_TIMESTAMP()"},
		func(iter *spanner.RowIterator) error {
			var err error
			got, err = collectOneRow(iter, func(row *spanner.Row) (time.Time, error) {
				var ts time.Time
				return ts, row.Columns(&ts)
			})
			return err
		},
	)
	require.NoError(t, err)
	assert.Equal(t, time.UTC, got.Location())
}
