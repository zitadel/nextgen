// Package metrics holds every instrument the server reports through, declared
// once in the catalogue (catalogue.go) that the documentation, the tests and
// the metric views are built from. Instruments are recorded in one of two
// styles:
//
//   - The catalogue's own instruments are created once on the global meter
//     and recorded through package functions (record.go), the way the tracers
//     work: a storage statement or a service method records without being
//     handed a provider, and nothing is recorded until the server installs one
//     with a reader. This is the style for code that runs on every request.
//   - A component that exists several times with a name of its own, such as a
//     cache, builds its instrument set with WithMeterProvider (cache.go), so
//     each instance reports under its name and a test or an embedded use
//     without a provider records nothing.
//
// Everything in this package takes primitives -- a name, a func() int, a
// typed constant -- and never a domain or storage type. That is what keeps it
// importable from any layer without dragging dependencies along or risking an
// import cycle.
package metrics

import (
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
)

// ScopeName identifies these instruments as the producer, the way
// otelhttp.ScopeName does for the HTTP instrumentation zotel filters on. It
// belongs to this package rather than to whatever wires it up: a caller passes
// the provider it already has and never has to know, or agree on, a scope
// string.
const ScopeName = "zitadel/backend/v3/instrumentation/metrics"

// Option configures an instrument set. A constructor that accepts these can
// stay unaware of telemetry beyond passing them through.
type Option func(*options)

type options struct {
	provider metric.MeterProvider
}

// WithMeterProvider records through provider. Without it nothing is recorded,
// which is what keeps tests and embedded uses free of a meter they never asked
// for.
func WithMeterProvider(provider metric.MeterProvider) Option {
	return func(o *options) {
		if provider != nil {
			o.provider = provider
		}
	}
}

// meter resolves the options into the meter an instrument set reports on.
func meter(opts []Option) metric.Meter {
	resolved := options{provider: noop.NewMeterProvider()}
	for _, opt := range opts {
		opt(&resolved)
	}
	return resolved.provider.Meter(ScopeName)
}
