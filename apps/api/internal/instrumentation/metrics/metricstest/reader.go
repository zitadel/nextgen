// Package metricstest reads back what package metrics recorded, for tests of
// the code that records. It installs a collecting meter provider as the
// process's global one, which is where the catalogue's instruments report.
//
// The provider is cumulative and shared by every test in the binary, so a
// test asserts the change it caused (read, act, read again) rather than an
// absolute value, and two tests that record on the same instrument with the
// same attributes must not run in parallel with each other.
package metricstest

import (
	"slices"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// Reader collects what the global meter provider holds.
type Reader struct {
	reader *sdkmetric.ManualReader
}

// Install sets the global meter provider to one that collects into the
// returned Reader, once per process; later calls return the same Reader.
// The global delegate binds already created instruments to the first
// provider installed, so Install has to run before anything else in the
// binary installs one.
var Install = sync.OnceValue(func() *Reader {
	reader := sdkmetric.NewManualReader()
	otel.SetMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)))
	return &Reader{reader: reader}
})

// Collect reads every instrument the provider holds.
func (r *Reader) Collect(t testing.TB) metricdata.ResourceMetrics {
	t.Helper()
	var collected metricdata.ResourceMetrics
	if err := r.reader.Collect(t.Context(), &collected); err != nil {
		t.Fatalf("collect metrics: %v", err)
	}
	return collected
}

// CounterSum returns the value of the counter or up-down counter called name
// at exactly the attribute set attrs, cumulative since the process started.
// An instrument or set never recorded is zero.
func (r *Reader) CounterSum(t testing.TB, name string, attrs ...attribute.KeyValue) int64 {
	t.Helper()
	want := attribute.NewSet(attrs...)
	for _, m := range r.find(t, name) {
		data, ok := m.Data.(metricdata.Sum[int64])
		if !ok {
			t.Fatalf("%s is a %T, not a counter", name, m.Data)
		}
		for _, point := range data.DataPoints {
			if point.Attributes.Equals(&want) {
				return point.Value
			}
		}
	}
	return 0
}

// HistogramCount returns how many measurements the histogram called name
// holds at exactly the attribute set attrs, cumulative since the process
// started. An instrument or set never recorded is zero.
func (r *Reader) HistogramCount(t testing.TB, name string, attrs ...attribute.KeyValue) uint64 {
	t.Helper()
	want := attribute.NewSet(attrs...)
	for _, m := range r.find(t, name) {
		data, ok := m.Data.(metricdata.Histogram[float64])
		if !ok {
			t.Fatalf("%s is a %T, not a histogram", name, m.Data)
		}
		for _, point := range data.DataPoints {
			if point.Attributes.Equals(&want) {
				return point.Count
			}
		}
	}
	return 0
}

// measurements is the counter's value or the histogram's count at exactly
// attrs, whichever the instrument called name is.
func (r *Reader) measurements(t testing.TB, name string, attrs ...attribute.KeyValue) int64 {
	t.Helper()
	for _, m := range r.find(t, name) {
		if _, ok := m.Data.(metricdata.Histogram[float64]); ok {
			return int64(r.HistogramCount(t, name, attrs...))
		}
	}
	return r.CounterSum(t, name, attrs...)
}

// GrewOnly is the check for "one value of a closed set grew by one and the
// others did not". It reads the counter or histogram called name now, at
// every value of key together with the fixed attributes, and returns a func
// that reads again and asserts the deltas: one for want, zero for the rest.
// An empty want asserts that nothing grew.
//
//	revocations := metricstest.GrewOnly(t, reader, metrics.TokenRevocationChecks, nil,
//		metrics.ResultKey, metrics.RevocationActive, metrics.RevocationRevoked, metrics.RevocationError)
//	// ... the call under test ...
//	revocations(metrics.RevocationActive)
func GrewOnly[T ~string](t testing.TB, r *Reader, name string, fixed []attribute.KeyValue, key attribute.Key, values ...T) func(want T) {
	t.Helper()
	attrs := func(v T) []attribute.KeyValue {
		return append(slices.Clone(fixed), key.String(string(v)))
	}
	before := make(map[T]int64, len(values))
	for _, v := range values {
		before[v] = r.measurements(t, name, attrs(v)...)
	}
	return func(want T) {
		t.Helper()
		if want != "" && !slices.Contains(values, want) {
			t.Errorf("%s: %q is not one of the values read", name, want)
		}
		for _, v := range values {
			var delta int64
			if v == want {
				delta = 1
			}
			assert.Equal(t, before[v]+delta, r.measurements(t, name, attrs(v)...), "%s: %s=%s", name, key, v)
		}
	}
}

// Recorded is one instrument as a collection returned it.
type Recorded struct {
	Scope       string
	Description string
	Unit        string
	Kind        metrics.Kind
	// Keys are the attribute keys its data points carry, in order of first
	// appearance.
	Keys []attribute.Key
}

// Instruments walks a collection and returns every instrument in it by name,
// with the attribute keys its data points carry. An instrument whose data is
// none of the kinds the catalogue declares is skipped.
func Instruments(collected metricdata.ResourceMetrics) map[string]Recorded {
	out := map[string]Recorded{}
	for _, scope := range collected.ScopeMetrics {
		for _, m := range scope.Metrics {
			r := Recorded{Scope: scope.Scope.Name, Description: m.Description, Unit: m.Unit}
			var sets []attribute.Set
			switch data := m.Data.(type) {
			case metricdata.Histogram[float64]:
				r.Kind = metrics.KindHistogram
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			case metricdata.Sum[int64]:
				r.Kind = metrics.KindCounter
				if !data.IsMonotonic {
					r.Kind = metrics.KindUpDownCounter
				}
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			case metricdata.Gauge[int64]:
				r.Kind = metrics.KindGauge
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			default:
				continue
			}
			for _, set := range sets {
				for _, kv := range set.ToSlice() {
					if !slices.Contains(r.Keys, kv.Key) {
						r.Keys = append(r.Keys, kv.Key)
					}
				}
			}
			out[m.Name] = r
		}
	}
	return out
}

func (r *Reader) find(t testing.TB, name string) []metricdata.Metrics {
	t.Helper()
	var found []metricdata.Metrics
	for _, scope := range r.Collect(t).ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name == name {
				found = append(found, m)
			}
		}
	}
	return found
}
