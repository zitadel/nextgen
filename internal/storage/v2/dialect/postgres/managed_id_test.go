package postgres

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestStatements_NewManagedID(t *testing.T) {
	t.Parallel()
	var s statements
	id, err := s.NewManagedID(string(domain.PrefixProject))
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(id, string(domain.PrefixProject)+"_"))
}
