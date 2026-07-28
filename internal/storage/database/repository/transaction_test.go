package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbmock"
	"go.uber.org/mock/gomock"
)

func TestWithTransaction_UsesClientBeginnerAndPropagatesEndError(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := dbmock.NewMockPool(ctrl)
	tx := dbmock.NewMockTransaction(ctrl)
	want := errors.New("operation failed")

	pool.EXPECT().Begin(gomock.Any(), gomock.Nil()).Return(tx, nil)
	tx.EXPECT().End(gomock.Any(), want).Return(want)

	err := withTransaction(context.Background(), pool, func(context.Context, database.QueryExecutor) error {
		return want
	})
	require.ErrorIs(t, err, want)
}

func TestWithTransaction_NonBeginnerRunsDirectly(t *testing.T) {
	ctrl := gomock.NewController(t)
	exec := dbmock.NewMockQueryExecutor(ctrl)

	called := false
	err := withTransaction(context.Background(), exec, func(_ context.Context, q database.QueryExecutor) error {
		called = true
		require.Same(t, exec, q)
		return nil
	})
	require.NoError(t, err)
	require.True(t, called)
}
