package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// resolveSchemaError is the one place the resolver's failures become
// caller-visible schema errors; the re-stamps also make the codes visible to
// the OpenAPI error analysis for schema operations only.
func TestResolveSchemaError(t *testing.T) {
	t.Run("typed fetch errors keep their code, details, and parent", func(t *testing.T) {
		cause := errors.New("dial blocked")
		in := domain.ErrJSONSchemaFetchDenied().
			WithDetails(domain.SchemaFetchDetails{URL: "https://host.test/x.json"}).
			WithParent(cause)

		out := resolveSchemaError(in)
		require.ErrorIs(t, out, domain.ErrJSONSchemaFetchDenied())
		de, ok := errors.AsType[domain.Error](out)
		require.True(t, ok)
		assert.Equal(t, domain.SchemaFetchDetails{URL: "https://host.test/x.json"}, de.Details)
		assert.ErrorIs(t, de.Parent, cause)
	})

	t.Run("a bare envelope expiry becomes fetch_timeout", func(t *testing.T) {
		out := resolveSchemaError(context.DeadlineExceeded)
		require.ErrorIs(t, out, domain.ErrJSONSchemaFetchTimeout())
	})

	t.Run("anything else is internal", func(t *testing.T) {
		out := resolveSchemaError(errors.New("boom"))
		require.ErrorIs(t, out, domain.ErrInternal(nil))
	})
}
