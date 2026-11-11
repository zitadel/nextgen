package errreport_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/sloggcp"
)

type stubReportLocation struct {
	loc *sloggcp.ReportLocation
}

func (e stubReportLocation) Error() string { return "stub location" }

func (e stubReportLocation) ReportLocation() *sloggcp.ReportLocation { return e.loc }

type stubStackTrace struct {
	trace []byte
}

func (e stubStackTrace) Error() string { return "stub stack" }

func (e stubStackTrace) StackTrace() ([]byte, bool) { return e.trace, true }

type stubChained struct {
	stubReportLocation
	stubStackTrace
}

func (e stubChained) Error() string { return "stub chained" }

func TestCapture_inheritsDeepestParentMetadata(t *testing.T) {
	deepLoc := &sloggcp.ReportLocation{
		FilePath:     "/deep/file.go",
		LineNumber:   42,
		FunctionName: "deep.Func",
	}
	deepStack := []byte("deepest-stack")

	parent := stubChained{
		stubReportLocation: stubReportLocation{loc: deepLoc},
		stubStackTrace:     stubStackTrace{trace: deepStack},
	}

	errreport.EnableLocation(false)
	errreport.EnableStack(false)
	t.Cleanup(func() {
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	origin := errreport.Capture(parent, 0)

	assert.Same(t, deepLoc, origin.ReportLocation())
	trace, ok := origin.StackTrace()
	require.True(t, ok)
	assert.Equal(t, deepStack, trace)
}

func TestCapture_freshWhenEnabledAndParentBare(t *testing.T) {
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	t.Cleanup(func() {
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	origin := errreport.Capture(errors.New("bare"), 0)

	require.NotNil(t, origin.ReportLocation())
	assert.NotEmpty(t, origin.ReportLocation().FilePath)
	trace, ok := origin.StackTrace()
	require.True(t, ok)
	assert.NotEmpty(t, trace)
}

func TestCapture_skipsFreshWhenDisabled(t *testing.T) {
	errreport.EnableLocation(false)
	errreport.EnableStack(false)
	t.Cleanup(func() {
		errreport.EnableLocation(true)
		errreport.EnableStack(true)
	})

	origin := errreport.Capture(errors.New("bare"), 0)

	assert.Nil(t, origin.ReportLocation())
	_, ok := origin.StackTrace()
	assert.False(t, ok)
}

func TestCapture_deepestLocationInUnwrapChain(t *testing.T) {
	shallow := &sloggcp.ReportLocation{FilePath: "/shallow.go", LineNumber: 1}
	deep := &sloggcp.ReportLocation{FilePath: "/deep.go", LineNumber: 2}

	chain := locationChain{
		loc:   shallow,
		cause: stubReportLocation{loc: deep},
	}

	errreport.EnableLocation(false)
	t.Cleanup(func() { errreport.EnableLocation(true) })

	origin := errreport.Capture(chain, 0)
	assert.Same(t, deep, origin.ReportLocation())
}

type locationChain struct {
	loc   *sloggcp.ReportLocation
	cause error
}

func (c locationChain) Error() string { return "chain" }

func (c locationChain) Unwrap() error { return c.cause }

func (c locationChain) ReportLocation() *sloggcp.ReportLocation { return c.loc }
