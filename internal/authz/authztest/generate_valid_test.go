package authztest_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/authztest"
	"github.com/zitadel/nextgen/internal/authz/compiler"
)

func TestGenerateValidModelAlwaysCompiles(t *testing.T) {
	const seeds = 500
	for i := 0; i < seeds; i++ {
		model := authztest.GenerateValidModel(authztest.Seed(i))
		output, err := compiler.Compile(model)
		require.NoError(t, err, "seed %d", i)
		require.NotEmpty(t, output.Catalog.Relations, "seed %d", i)
	}
}
