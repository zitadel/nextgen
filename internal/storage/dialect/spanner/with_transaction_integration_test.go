//go:build spanner_integration

package spanner

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A traced client hides its type from withTransaction; without the unwrap the
// statement would run outside any transaction.
func TestWithTransaction_tracedClientOpensTransaction(t *testing.T) {
	want := errors.New("boom")
	err := withTransaction(t.Context(), traced(newClientDB(testClient.client)), func(ctx context.Context, got queryExecutor) error {
		require.IsType(t, tracedExecutor{}, got)
		assert.IsType(t, tx{}, untraced(got))
		return want
	})
	require.ErrorIs(t, err, want)
}

func TestWithTransaction_tracedClientCommitsOnSuccess(t *testing.T) {
	project := newTestProject(uniqueProjectID(t))
	t.Cleanup(func() { _, _ = testClient.DeleteProjectByID(context.Background(), project.ID) })

	err := withTransaction(t.Context(), traced(newClientDB(testClient.client)), func(ctx context.Context, tx queryExecutor) error {
		return newProjectStatements(tx).CreateProject(ctx, project)
	})
	require.NoError(t, err)

	got, err := testClient.GetProjectByID(t.Context(), project.ID)
	require.NoError(t, err)
	assert.Equal(t, project.Name, got.Name)
}
