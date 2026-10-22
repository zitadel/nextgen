package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// Documents that CreateSession routes multi-write steps through withTransaction
// (begin → writes on inner tx → rollback on error).
func TestCreateSession_wrapsMultiWriteInTransaction(t *testing.T) {
	t.Parallel()

	forced := errors.New("boom on user agent insert")
	inner := &failOnQueryRowStubTx{fail: forced}
	beginner := &txBeginner{tx: inner}
	err := newSessionStatements(beginner).CreateSession(t.Context(), &domain.Session{
		ProjectID:  "proj",
		UserAgent:  &domain.UserAgent{ID: "fp", IP: "203.0.113.1"},
		TimeToLive: domain.SessionAnonymousTTL,
	})
	require.ErrorIs(t, err, forced)
	assert.False(t, inner.committed)
	assert.True(t, inner.rolledBack)
}

type failOnQueryRowStubTx struct {
	stubTx
	fail error
}

func (t *failOnQueryRowStubTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return errRow{err: t.fail}
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }
