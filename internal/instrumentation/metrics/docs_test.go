package metrics_test

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// The reference in docs/operations/metrics.md is the catalogue written out. A
// documented attribute that the code does not carry, or an instrument the
// documentation has never heard of, is how a dashboard ends up graphing
// nothing.
func TestCatalogue_IsDocumented(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/operations/metrics.md")
	require.NoError(t, err)
	_, reference, ok := strings.Cut(string(raw), "\n## Reference\n")
	require.True(t, ok, "the document has no Reference section")

	sections := map[string]string{}
	for _, section := range strings.Split(reference, "\n### `")[1:] {
		name, body, _ := strings.Cut(section, "`")
		sections[name] = body
	}

	catalogued := map[string]bool{}
	for _, in := range metrics.Catalogue() {
		catalogued[in.Name] = true
		body, ok := sections[in.Name]
		if !assert.True(t, ok, "instrument %s is not documented", in.Name) {
			continue
		}
		assert.Contains(t, body, in.Description, "%s: description", in.Name)
		assert.Contains(t, body, "unit: `"+orDash(in.Unit)+"`", "%s: unit", in.Name)
		assert.Contains(t, body, string(in.Kind), "%s: type", in.Name)
		for _, a := range in.Attributes {
			assert.Contains(t, body, "| `"+string(a.Key)+"` |", "%s: attribute %s", in.Name, a.Key)
			for _, v := range a.Values {
				assert.Contains(t, body, "`"+v+"`", "%s: value %s of %s", in.Name, v, a.Key)
			}
		}
	}
	for name := range sections {
		assert.True(t, catalogued[name], "%s is documented but is not in the catalogue", name)
	}
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
