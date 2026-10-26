package metrics_test

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// The Metrics section of the configuration guide is the catalogue written
// out. A documented attribute that the code does not carry, or an instrument
// the documentation has never heard of, is how a dashboard ends up graphing
// nothing.
func TestCatalogue_IsDocumented(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("../../../docs/quick-start/configuration.md")
	require.NoError(t, err)
	_, section, ok := strings.Cut(string(raw), "\n## Metrics\n")
	require.True(t, ok, "the configuration guide has no Metrics section")
	section, _, _ = strings.Cut(section, "\n## ")

	var rows []string
	for line := range strings.SplitSeq(section, "\n") {
		if strings.HasPrefix(line, "| `") {
			rows = append(rows, line)
		}
	}

	documented := map[string]bool{}
	for _, in := range metrics.Catalogue() {
		row := ""
		for _, r := range rows {
			if strings.HasPrefix(r, "| `"+in.Name+"` |") {
				row = r
			}
		}
		if !assert.NotEmpty(t, row, "instrument %s is not documented", in.Name) {
			continue
		}
		documented[in.Name] = true
		assert.Contains(t, row, "| "+string(in.Kind)+" |", "%s: type", in.Name)
		assert.Contains(t, row, "| "+orDash(in.Unit)+" |", "%s: unit", in.Name)
		assert.Contains(t, row, in.Description, "%s: description", in.Name)
		for _, a := range in.Attributes {
			assert.Contains(t, row, "`"+string(a.Key)+"`: ", "%s: attribute %s", in.Name, a.Key)
			for _, v := range a.Values {
				assert.Contains(t, row, "`"+v+"`", "%s: value %s of %s", in.Name, v, a.Key)
			}
			if !a.Closed() {
				assert.Contains(t, row, "`"+string(a.Key)+"`: fixed in code", "%s: %s is open", in.Name, a.Key)
			}
		}
	}
	for _, r := range rows {
		name, _, _ := strings.Cut(strings.TrimPrefix(r, "| `"), "`")
		if strings.HasPrefix(name, "instrumentation.") {
			continue // the configuration table
		}
		assert.True(t, documented[name], "%s is documented but is not in the catalogue", name)
	}
}

func orDash(unit string) string {
	if unit == "" {
		return "-"
	}
	return "`" + unit + "`"
}
