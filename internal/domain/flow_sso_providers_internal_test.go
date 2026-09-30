package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The engine emits the slugs a step offers; the API resolves each to its
// connection before the step reaches the client. A step rendered without them
// offers the client nothing to draw, whatever connections the project holds.
func TestSSOProvidersFromSlugs(t *testing.T) {
	t.Run("carries the slugs a step offers, in order", func(t *testing.T) {
		got := ssoProvidersFromSlugs([]string{"google", "acme"})

		require.Len(t, got, 2)
		assert.Equal(t, "google", got[0].ID)
		assert.Equal(t, "acme", got[1].ID)
		// Name and template belong to the connection, not the flow.
		assert.Empty(t, got[0].Name)
		assert.Empty(t, got[0].Template)
	})

	t.Run("renders nothing for a step that offers none", func(t *testing.T) {
		assert.Nil(t, ssoProvidersFromSlugs(nil))
		assert.Nil(t, ssoProvidersFromSlugs([]string{}))
	})

	t.Run("skips a blank slug rather than offering a nameless button", func(t *testing.T) {
		assert.Nil(t, ssoProvidersFromSlugs([]string{""}))
	})
}
