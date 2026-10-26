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
	"sync"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// Reader collects what the global meter provider holds.
type Reader struct {
	reader *sdkmetric.ManualReader
}

var install = sync.OnceValue(func() *Reader {
	reader := sdkmetric.NewManualReader()
	otel.SetMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)))
	return &Reader{reader: reader}
})

// Install sets the global meter provider to one that collects into the
// returned Reader, once per process; later calls return the same Reader.
// The global delegate binds already created instruments to the first
// provider installed, so Install has to run before anything else in the
// binary installs one.
func Install() *Reader {
	return install()
}

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
