package egresslint_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"

	"github.com/zitadel/nextgen/tools/analyzers/egresslint"
)

func TestViolations(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), egresslint.Analyzer, "violations")
}

func TestExempted(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), egresslint.Analyzer, "exempted")
}

func TestSanctionedPackageIsSkipped(t *testing.T) {
	a := egresslint.Analyzer
	if err := a.Flags.Set("sanctioned", "sanctioned"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Flags.Set("sanctioned", "github.com/zitadel/nextgen/internal/httputil") })
	analysistest.Run(t, analysistest.TestData(), a, "sanctioned")
}

func TestTestFilesCheckedOnFlag(t *testing.T) {
	a := egresslint.Analyzer
	if err := a.Flags.Set("check-tests", "true"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Flags.Set("check-tests", "false") })
	analysistest.Run(t, analysistest.TestData(), a, "testfiles")
}
