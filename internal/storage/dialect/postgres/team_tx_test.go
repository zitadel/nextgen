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

// Documents that DeactivateTeam routes multi-write steps through withTransaction
// (begin → writes on inner tx → rollback on error).
func TestDeactivateTeam_wrapsMultiWriteInTransaction(t *testing.T) {
	t.Parallel()

	forced := errors.New("boom on second write")
	inner := &failOnNthStubTx{failOn: 2, fail: forced}
	beginner := &txBeginner{tx: inner}
	_, err := newTeamStatements(beginner).DeactivateTeam(t.Context(), "proj", "team")
	require.ErrorIs(t, err, forced)
	assert.False(t, inner.committed)
	assert.True(t, inner.rolledBack)
	assert.Equal(t, 2, inner.execs)
}

type txBeginner struct {
	tx pgx.Tx
}

func (b *txBeginner) Begin(context.Context) (pgx.Tx, error) {
	return b.tx, nil
}

func (b *txBeginner) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), errors.New("beginner must not Exec")
}

func (b *txBeginner) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("beginner must not Query")
}

func (b *txBeginner) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

type failOnNthStubTx struct {
	stubTx
	failOn int
	fail   error
}

func (t *failOnNthStubTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	t.execs++
	if t.execs >= t.failOn {
		return pgconn.CommandTag{}, t.fail
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}
