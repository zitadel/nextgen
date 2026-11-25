// Package errreport centralizes error location and stack capture for structured
// logging and GCP Error Reporting (ADR 030). It is a leaf package: it depends
// only on sloggcp and the runtime, not on domain or storage types.
package errreport

import (
	"errors"
	"runtime/debug"
	"sync/atomic"

	"github.com/zitadel/sloggcp"
)

var (
	enableLocation atomic.Bool
	enableStack    atomic.Bool
	gcpReporting   atomic.Bool
)

// EnableLocation toggles structured report-location capture for newly
// constructed errors when no deeper location exists in the parent chain.
func EnableLocation(enable bool) {
	enableLocation.Store(enable)
}

// EnableStack toggles stack capture for newly constructed errors when no
// deeper stack exists in the parent chain.
func EnableStack(enable bool) {
	enableStack.Store(enable)
}

// GCPReporting toggles GCP Error Reporting log shaping. When enabled,
// per-error LogValue implementations omit location and stack because the GCP
// handler adds them from the ReportLocationError / StackTraceError interfaces.
func GCPReporting(enable bool) {
	gcpReporting.Store(enable)
}

// GCPReportingEnabled reports whether GCP Error Reporting shaping is active.
func GCPReportingEnabled() bool {
	return gcpReporting.Load()
}

// Origin carries structured report location and an optional stack trace.
// Embed it in layer-specific error types and implement sloggcp interfaces via
// the promoted methods.
type Origin struct {
	location *sloggcp.ReportLocation
	stack    []byte
}

// ReportLocation implements [sloggcp.ReportLocationError].
func (o Origin) ReportLocation() *sloggcp.ReportLocation {
	return o.location
}

// StackTrace implements [sloggcp.StackTraceError].
func (o Origin) StackTrace() ([]byte, bool) {
	if len(o.stack) == 0 {
		return nil, false
	}
	return o.stack, true
}

// Capture records diagnostic origin metadata for a newly constructed error.
//
// Location and stack follow deepest-first inheritance: when parent already
// implements the sloggcp interfaces anywhere in its unwrap chain, the deepest
// values are reused. Otherwise a fresh location and/or stack is captured when
// the corresponding global toggle is enabled.
//
// callerSkip is the number of frames to skip to reach the logical construction
// call site, matching [runtime.Caller] at that site (for example 2 from
// domain.newError, 1 from domain.Error.WithParent).
func Capture(parent error, callerSkip int) Origin {
	var origin Origin

	if loc := deepestReportLocation(parent); loc != nil {
		origin.location = loc
	} else if enableLocation.Load() {
		origin.location = sloggcp.NewReportLocation(callerSkip + captureFrames)
	}

	if trace, ok := deepestStackTrace(parent); ok {
		origin.stack = trace
	} else if enableStack.Load() {
		origin.stack = debug.Stack()
	}

	return origin
}

const captureFrames = 2 // Capture and NewReportLocation between caller and runtime.Caller.

func deepestReportLocation(err error) *sloggcp.ReportLocation {
	var deepest *sloggcp.ReportLocation
	for err != nil {
		var rle sloggcp.ReportLocationError
		if errors.As(err, &rle) {
			if loc := rle.ReportLocation(); loc != nil {
				deepest = loc
			}
		}
		err = errors.Unwrap(err)
	}
	return deepest
}

func deepestStackTrace(err error) ([]byte, bool) {
	var (
		deepest []byte
		ok      bool
	)
	for err != nil {
		var ste sloggcp.StackTraceError
		if errors.As(err, &ste) {
			if trace, traceOK := ste.StackTrace(); traceOK {
				deepest = trace
				ok = true
			}
		}
		err = errors.Unwrap(err)
	}
	return deepest, ok
}
