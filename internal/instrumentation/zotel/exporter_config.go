package zotel

import (
	"fmt"
	"time"
)

//go:generate go tool enumer -type=ExporterType -trimprefix=ExporterType -text -linecomment
type ExporterType int

// ExporterType defines the type of exporter to use.
// - metrics supports all types
// - tracing supports all types except Prometheus
// - logging supports all types except Google and Prometheus
// - profiling supports only Google and None
const (
	ExporterTypeUnspecified ExporterType = iota //
	ExporterTypeNone
	ExporterTypeStdOut
	ExporterTypeStdErr
	ExporterTypeGRPC
	ExporterTypeHTTP
	ExporterTypeGoogle
	ExporterTypePrometheus
	ExporterTypeAuto
)

type ExporterConfig struct {
	Type            ExporterType  `mapstructure:"type"`
	Endpoint        string        `mapstructure:"endpoint"`
	Insecure        bool          `mapstructure:"insecure"`
	BatchDuration   time.Duration `mapstructure:"batch_duration"`
	GoogleProjectID string        `mapstructure:"google_project_id"` // only for tracing, metrics and profiler
}

func errExporterType(typ ExporterType, instrument string) error {
	return fmt.Errorf("exporter type \"%v\" unsupported for %s", typ, instrument)
}
