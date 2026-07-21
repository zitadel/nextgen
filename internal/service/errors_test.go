package service

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestMapStorageError(t *testing.T) {
	t.Parallel()

	t.Run("nil", func(t *testing.T) {
		t.Parallel()
		assert.NoError(t, mapStorageError(nil))
	})

	t.Run("unimplemented", func(t *testing.T) {
		t.Parallel()
		err := mapStorageError(database.NewUnimplementedError(nil))
		require.Error(t, err)
		var de domain.Error
		require.True(t, errors.As(err, &de))
		assert.Equal(t, domain.ErrNotImplemented().Code, de.Code)
		assert.ErrorIs(t, err, &database.UnimplementedError{})
	})

	t.Run("passthrough", func(t *testing.T) {
		t.Parallel()
		orig := database.NewNoRowFoundError(nil)
		assert.Same(t, orig, mapStorageError(orig))
	})
}
