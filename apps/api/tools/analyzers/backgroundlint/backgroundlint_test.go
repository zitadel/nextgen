package backgroundlint_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"

	"github.com/zitadel/nextgen/tools/analyzers/backgroundlint"
)

func TestViolations(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), backgroundlint.Analyzer, "violations")
}

func TestExempted(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), backgroundlint.Analyzer, "exempted")
}

func TestSanctionedPackageIsSkipped(t *testing.T) {
	a := backgroundlint.Analyzer
	if err := a.Flags.Set("sanctioned", "sanctioned"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Flags.Set("sanctioned", "github.com/zitadel/nextgen/internal/background") })
	analysistest.Run(t, analysistest.TestData(), a, "sanctioned")
}
