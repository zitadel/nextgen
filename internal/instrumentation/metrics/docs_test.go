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
// out, row for row. A documented attribute or value the code does not carry,
// or an instrument the documentation has never heard of, is how a dashboard
// ends up graphing nothing, so each row has to equal what the catalogue says.
func TestCatalogue_IsDocumented(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("../../../docs/quick-start/configuration.md")
	require.NoError(t, err)
	_, section, ok := strings.Cut(string(raw), "\n## Metrics\n")
	require.True(t, ok, "the configuration guide has no Metrics section")
	section, _, _ = strings.Cut(section, "\n## ")

	rows := map[string][]string{}
	for line := range strings.SplitSeq(section, "\n") {
		if !strings.HasPrefix(line, "| `") {
			continue
		}
		cells := strings.Split(strings.TrimSuffix(strings.TrimPrefix(line, "| "), " |"), " | ")
		rows[strings.Trim(cells[0], "`")] = cells
	}

	documented := map[string]bool{}
	for _, in := range metrics.Catalogue() {
		cells, ok := rows[in.Name]
		if !assert.True(t, ok, "instrument %s is not documented", in.Name) {
			continue
		}
		documented[in.Name] = true
		assert.Equal(t, []string{"`" + in.Name + "`", string(in.Kind), orDash(in.Unit), attributesCell(in), in.Description}, cells, "%s: row", in.Name)
	}
	for name := range rows {
		if strings.HasPrefix(name, "instrumentation.") {
			continue // the configuration table
		}
		assert.True(t, documented[name], "%s is documented but is not in the catalogue", name)
	}
}

// attributesCell is the Attributes cell of a documented row as the catalogue
// entry says it should read: each attribute as `key`: its values in
// backticks, or "fixed in code" for an open one; attributes separated by
// semicolons.
func attributesCell(in metrics.Instrument) string {
	var attrs []string
	for _, a := range in.Attributes {
		cell := "`" + string(a.Key) + "`: fixed in code"
		if a.Closed() {
			cell = "`" + string(a.Key) + "`: `" + strings.Join(a.Values, "`, `") + "`"
		}
		attrs = append(attrs, cell)
	}
	return strings.Join(attrs, "; ")
}

func orDash(unit string) string {
	if unit == "" {
		return "-"
	}
	return "`" + unit + "`"
}
