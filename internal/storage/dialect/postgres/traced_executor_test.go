package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
)

type scanErrRow struct{ err error }

func (r scanErrRow) Scan(...any) error { return r.err }

// rowExecutor returns row from QueryRow; the other methods are unused.
type rowExecutor struct {
	*stubExecutor
	row pgx.Row
}

func (e rowExecutor) QueryRow(context.Context, string, ...any) pgx.Row { return e.row }

var _ queryExecutor = rowExecutor{}

// QueryRow reports its error on Scan, so the statement span has to end there.
func TestTracedExecutor_queryRowEndsOnScan(t *testing.T) {
	tests := []struct {
		name     string
		scanErr  error
		wantCode codes.Code
	}{
		{name: "scan error", scanErr: &pgconn.PgError{Code: "23505"}, wantCode: codes.Error},
		{name: "no rows is not an error", scanErr: pgx.ErrNoRows, wantCode: codes.Unset},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spanExporter.Reset()
			row := traced(rowExecutor{row: scanErrRow{err: tt.scanErr}}).QueryRow(sampledContext(t), "INSERT ... RETURNING id")
			require.Empty(t, spanExporter.GetSpans(), "the span must stay open until Scan")

			err := row.Scan()
			require.True(t, errors.Is(err, tt.scanErr))

			spans := spanExporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, tt.wantCode, spans[0].Status.Code)
		})
	}
}

// rowStatements stands for a statements type: the statement takes its name
// from the method that issues it.
type rowStatements struct{ client queryExecutor }

func (s rowStatements) InsertRow(ctx context.Context) pgx.Row {
	return s.client.QueryRow(ctx, "INSERT ... RETURNING id")
}

// The statement is timed until Scan too, so the histogram counts it there.
func TestTracedExecutor_queryRowTimesUntilScan(t *testing.T) {
	reader := metricstest.Install()
	summary := metrics.DBQuerySummaryKey.String("rowStatements.InsertRow")
	system := metrics.DBSystemNameKey.String(string(dbSystem))
	before := reader.HistogramCount(t, metrics.DBOperationDuration, system, summary)

	row := rowStatements{client: traced(rowExecutor{row: scanErrRow{}})}.InsertRow(t.Context())
	assert.Equal(t, before, reader.HistogramCount(t, metrics.DBOperationDuration, system, summary),
		"the statement is not over until Scan")

	require.NoError(t, row.Scan())
	assert.Equal(t, before+1, reader.HistogramCount(t, metrics.DBOperationDuration, system, summary))
}
