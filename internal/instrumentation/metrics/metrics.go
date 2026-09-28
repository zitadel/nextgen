// Package metrics holds the instrument sets the server reports through, one
// per kind of thing worth measuring, so a component becomes observable by
// passing an option to its constructor rather than by declaring instruments of
// its own. Cache instruments live in cache.go; a new family is a new file here.
//
// Everything in this package takes primitives -- a name, a func() int -- and
// never a domain or storage type. That is what keeps it importable from any
// layer without dragging dependencies along or risking an import cycle.
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
