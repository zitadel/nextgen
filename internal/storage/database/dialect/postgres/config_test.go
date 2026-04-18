package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRetry(t *testing.T) {
	t.Parallel()

	t.Run("succeeds on first attempt", func(t *testing.T) {
		t.Parallel()
		attempts := 0

		err := retry(t.Context(), 3, time.Millisecond, func(ctx context.Context) error {
			attempts++
			return nil
		})

		require.NoError(t, err)
		require.Equal(t, 1, attempts)
	})

	t.Run("retries until success", func(t *testing.T) {
		t.Parallel()
		attempts := 0

		err := retry(t.Context(), 5, time.Millisecond, func(ctx context.Context) error {
			attempts++
			if attempts < 3 {
				return errors.New("temporary error")
			}
			return nil
		})

		require.NoError(t, err)
		require.Equal(t, 3, attempts)
	})

	t.Run("returns last error after all retries", func(t *testing.T) {
		t.Parallel()
		attempts := 0
		expected := errors.New("still failing")

		err := retry(t.Context(), 3, time.Millisecond, func(ctx context.Context) error {
			attempts++
			return expected
		})

		require.ErrorIs(t, err, expected)
		require.Equal(t, 3, attempts)
	})

	t.Run("returns context error when canceled", func(t *testing.T) {
		t.Parallel()
		ctx, cancel := context.WithCancel(t.Context())
		attempts := 0

		err := retry(ctx, 3, time.Second, func(ctx context.Context) error {
			attempts++
			cancel()
			return errors.New("temporary error")
		})

		require.ErrorIs(t, err, context.Canceled)
		require.Equal(t, 1, attempts)
	})
}
