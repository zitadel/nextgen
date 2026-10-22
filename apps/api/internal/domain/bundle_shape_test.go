package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestValidateBundleShape(t *testing.T) {
	t.Parallel()

	t.Run("empty input yields no resource failures", func(t *testing.T) {
		t.Parallel()
		assert.Empty(t, domain.ValidateBundleShape(domain.BundleShapeInput{}))
		assert.True(t, domain.BundleEmpty(domain.BundleShapeInput{}))
	})

	t.Run("duplicate schema handle and $id both surface", func(t *testing.T) {
		t.Parallel()
		doc := []byte(`{"objectType":"human-user","$id":"https://example.com/h.json"}`)
		failures := domain.ValidateBundleShape(domain.BundleShapeInput{
			Schemas: []domain.BundleShapeSchema{
				{Index: 0, Document: doc},
				{Index: 1, Document: []byte(`{"objectType":"human-user"}`)},
			},
		})
		require.Len(t, failures, 3)
		assert.Equal(t, domain.ReleasePointerKindSchema, failures[0].Kind)
		assert.Equal(t, 0, failures[0].Index)
		assert.Contains(t, failures[0].Err.Details, "$id")
		assert.Equal(t, 0, failures[1].Index)
		assert.Contains(t, failures[1].Err.Details, "appears twice")
		assert.Equal(t, 1, failures[2].Index)
		assert.Contains(t, failures[2].Err.Details, "appears twice")
	})

	t.Run("missing flow name and duplicate idp slug", func(t *testing.T) {
		t.Parallel()
		failures := domain.ValidateBundleShape(domain.BundleShapeInput{
			Flows: []domain.BundleShapeFlow{{Index: 0, Name: "  "}},
			IDPs: []domain.BundleShapeIDP{
				{Index: 0, Document: []byte(`{"slug":"google"}`)},
				{Index: 1, Document: []byte(`{"slug":"google"}`)},
			},
		})
		require.Len(t, failures, 3)
		assert.Equal(t, domain.ReleasePointerKindFlowDefinition, failures[0].Kind)
		assert.Equal(t, domain.ReleasePointerKindIDP, failures[1].Kind)
		assert.Equal(t, "google", failures[1].Handle)
		assert.Equal(t, 0, failures[1].Index)
		assert.Equal(t, 1, failures[2].Index)
	})

	t.Run("schema URL entries skip objectType checks", func(t *testing.T) {
		t.Parallel()
		failures := domain.ValidateBundleShape(domain.BundleShapeInput{
			Schemas: []domain.BundleShapeSchema{{Index: 0, URL: "https://example.com/schema.json"}},
		})
		assert.Empty(t, failures)
	})
}
