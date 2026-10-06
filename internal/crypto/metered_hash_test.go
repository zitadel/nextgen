package crypto_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/passwap"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

type stubVerifier struct{ err error }

func (s stubVerifier) VerifyHash(string, string) error { return s.err }

// Not run in parallel: it replaces the process-wide default Application.
func TestMeteredHashVerifier(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "a matching password", want: "match"},
		{name: "a wrong password", err: passwap.ErrPasswordMismatch, want: "mismatch"},
		{name: "a wrong password, wrapped", err: fmt.Errorf("verify: %w", passwap.ErrPasswordMismatch), want: "mismatch"},
		{name: "a hash nobody can read", err: passwap.ErrNoVerifier, want: "error"},
		{name: "any other failure", err: errors.New("boom"), want: "error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := metric.NewManualReader()
			app, err := metrics.NewApplication(metrics.WithMeterProvider(metric.NewMeterProvider(metric.WithReader(reader))))
			require.NoError(t, err)
			metrics.SetDefault(app)
			t.Cleanup(func() { metrics.SetDefault(nil) })

			got := crypto.NewMeteredHashVerifier(stubVerifier{err: tt.err}).VerifyHash("encoded", "password")
			assert.Equal(t, tt.err, got, "the verifier's own answer is passed through untouched")

			var rm metricdata.ResourceMetrics
			require.NoError(t, reader.Collect(t.Context(), &rm))
			results := map[string]uint64{}
			for _, scope := range rm.ScopeMetrics {
				for _, m := range scope.Metrics {
					require.Equal(t, metrics.PasswordVerificationDuration, m.Name)
					for _, p := range m.Data.(metricdata.Histogram[float64]).DataPoints {
						result, _ := p.Attributes.Value(metrics.ResultKey)
						results[result.AsString()] += p.Count
					}
				}
			}
			assert.Equal(t, map[string]uint64{tt.want: 1}, results)
		})
	}
}
