package console

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// A binary built with -tags noconsole has no dist: both entry points refuse,
// so a server told to serve the console fails at startup instead of serving
// nothing.
func TestWithoutTheConsoleBothEntryPointsRefuse(t *testing.T) {
	embedded := dist
	dist = nil
	t.Cleanup(func() { dist = embedded })

	_, err := Handler("/ui/console")
	require.ErrorIs(t, err, errLeftOut)
	require.ErrorIs(t, ValidateDist(), errLeftOut)
}
