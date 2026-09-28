package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubExecutor struct {
	execs int
}

func (s *stubExecutor) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	s.execs++
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (s *stubExecutor) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("not implemented")
}

func (s *stubExecutor) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

type stubTx struct {
	stubExecutor
	committed  bool
	rolledBack bool
}

func (t *stubTx) Begin(context.Context) (pgx.Tx, error) {
	return t, nil
}

func (t *stubTx) Commit(context.Context) error {
	t.committed = true
	return nil
}

func (t *stubTx) Rollback(context.Context) error {
	t.rolledBack = true
	return nil
}

// Satisfy pgx.Tx for compile; unused methods panic if called unexpectedly.
func (t *stubTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	panic("unexpected")
}
func (t *stubTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { panic("unexpected") }
func (t *stubTx) LargeObjects() pgx.LargeObjects                         { panic("unexpected") }
func (t *stubTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	panic("unexpected")
}
func (t *stubTx) Conn() *pgx.Conn { panic("unexpected") }

type stubBeginner struct {
	tx *stubTx
}

func (b *stubBeginner) Begin(context.Context) (pgx.Tx, error) {
	return b.tx, nil
}

func (b *stubBeginner) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), errors.New("beginner must not Exec")
}

func (b *stubBeginner) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("beginner must not Query")
}

func (b *stubBeginner) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

func TestWithTransaction_nonBeginnerRunsDirectly(t *testing.T) {
	t.Parallel()
	exec := &stubExecutor{}
	err := withTransaction(t.Context(), exec, func(ctx context.Context, tx queryExecutor) error {
		_, err := tx.Exec(ctx, "UPDATE")
		return err
	})
	require.NoError(t, err)
	assert.Equal(t, 1, exec.execs)
}

func TestWithTransaction_beginnerCommitsOnSuccess(t *testing.T) {
	t.Parallel()
	inner := &stubTx{}
	beginner := &stubBeginner{tx: inner}
	err := withTransaction(t.Context(), beginner, func(ctx context.Context, tx queryExecutor) error {
		_, err := tx.Exec(ctx, "UPDATE")
		return err
	})
	require.NoError(t, err)
	assert.True(t, inner.committed)
	assert.False(t, inner.rolledBack)
	assert.Equal(t, 1, inner.execs)
}

func TestWithTransaction_beginnerRollsBackOnError(t *testing.T) {
	t.Parallel()
	inner := &stubTx{}
	beginner := &stubBeginner{tx: inner}
	want := errors.New("boom")
	err := withTransaction(t.Context(), beginner, func(ctx context.Context, tx queryExecutor) error {
		_, _ = tx.Exec(ctx, "UPDATE")
		return want
	})
	require.ErrorIs(t, err, want)
	assert.False(t, inner.committed)
	assert.True(t, inner.rolledBack)
	assert.Equal(t, 1, inner.execs)
}
