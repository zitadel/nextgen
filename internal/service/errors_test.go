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

	// A spent retry budget must not fall through to the callers'
	// "failed to commit transaction" catch-all, which reports it as a 500.
	t.Run("unavailable", func(t *testing.T) {
		t.Parallel()
		err := mapStorageError(database.NewUnavailableError(errors.New("transaction aborted")))
		require.Error(t, err)
		var de domain.Error
		require.True(t, errors.As(err, &de))
		assert.Equal(t, domain.ErrUnavailable().Code, de.Code)
		assert.ErrorIs(t, err, &database.UnavailableError{})
	})

	t.Run("coded database error", func(t *testing.T) {
		t.Parallel()
		err := mapStorageError(database.ErrInvalidCursor())
		require.Error(t, err)
		var de domain.Error
		require.True(t, errors.As(err, &de))
		assert.Equal(t, "db.invalid_cursor", de.Code)
		assert.Equal(t, database.ErrInvalidCursor().Message, de.Message)
	})

	t.Run("passthrough", func(t *testing.T) {
		t.Parallel()
		orig := database.NewNoRowFoundError(nil)
		assert.Same(t, orig, mapStorageError(orig))
	})
}
