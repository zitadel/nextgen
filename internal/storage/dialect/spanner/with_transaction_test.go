package spanner

import (
	"context"
	"errors"
	"testing"

	"cloud.google.com/go/spanner"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubDB struct {
	updates int
}

func (s *stubDB) Query(context.Context, spanner.Statement, func(*spanner.RowIterator) error) error {
	return errors.New("not implemented")
}

func (s *stubDB) Write(context.Context, spanner.Statement, func(*spanner.RowIterator) error) error {
	return errors.New("not implemented")
}

func (s *stubDB) Update(context.Context, spanner.Statement) (int64, error) {
	s.updates++
	return 1, nil
}

func (s *stubDB) BufferWrite(context.Context, []*spanner.Mutation) error {
	return errors.New("not implemented")
}

func (s *stubDB) ReadRow(context.Context, string, spanner.Key, []string) (*spanner.Row, error) {
	return nil, errors.New("not implemented")
}

func TestWithTransaction_alreadyInTxnRunsDirectly(t *testing.T) {
	t.Parallel()
	// tx is the unexported RW-txn wrapper; withTransaction must not open another.
	existing := tx{}
	called := false
	err := withTransaction(t.Context(), existing, func(ctx context.Context, got queryExecutor) error {
		called = true
		assert.IsType(t, tx{}, got)
		return nil
	})
	require.NoError(t, err)
	assert.True(t, called)
}

func TestWithTransaction_unknownExecutorRunsDirectly(t *testing.T) {
	t.Parallel()
	db := &stubDB{}
	err := withTransaction(t.Context(), db, func(ctx context.Context, tx queryExecutor) error {
		_, err := tx.Update(ctx, spanner.Statement{SQL: "UPDATE"})
		return err
	})
	require.NoError(t, err)
	assert.Equal(t, 1, db.updates)
}
