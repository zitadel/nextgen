package platform

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

func TestEnsure(t *testing.T) {
	t.Parallel()
	storageErr := errors.New("connection refused")

	wantProject := &domain.Project{
		ID:             domain.PlatformProjectID,
		Name:           "Platform",
		PreviewOrigins: []string{},
	}

	tests := []struct {
		name    string
		enabled bool
		// expect declares the reads and writes the case allows; an unexpected
		// CreateProject fails the test on its own.
		expect  func(*servicemocks.MockStatementPool, *servicemocks.MockAllStatements)
		wantErr error
	}{
		{
			name:    "disabled is a no-op with no statement calls",
			enabled: false,
			expect:  func(*servicemocks.MockStatementPool, *servicemocks.MockAllStatements) {},
		},
		{
			name:    "enabled creates the platform project",
			enabled: true,
			expect: func(pool *servicemocks.MockStatementPool, stmts *servicemocks.MockAllStatements) {
				pool.EXPECT().Statements().Return(stmts)
				stmts.EXPECT().CreateProject(gomock.Any(), wantProject).Return(nil)
			},
		},
		{
			name:    "existing platform project is accepted",
			enabled: true,
			expect: func(pool *servicemocks.MockStatementPool, stmts *servicemocks.MockAllStatements) {
				pool.EXPECT().Statements().Return(stmts)
				stmts.EXPECT().CreateProject(gomock.Any(), wantProject).
					Return(database.NewUniqueError("projects", "projects_pkey", nil))
			},
		},
		{
			name:    "other storage error is propagated wrapped",
			enabled: true,
			expect: func(pool *servicemocks.MockStatementPool, stmts *servicemocks.MockAllStatements) {
				pool.EXPECT().Statements().Return(stmts)
				stmts.EXPECT().CreateProject(gomock.Any(), wantProject).Return(storageErr)
			},
			wantErr: storageErr,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			pool := servicemocks.NewMockStatementPool(ctrl)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			tt.expect(pool, stmts)

			err := Ensure(t.Context(), pool, tt.enabled)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
		})
	}
}

// TestEnsureIdempotentAcrossRuns runs Ensure twice against the same mocked
// pool: the first insert succeeds and the second reports a duplicate primary
// key. Both calls must succeed and carry the configured id and "Platform" name.
func TestEnsureIdempotentAcrossRuns(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)

	wantProject := &domain.Project{
		ID:             domain.PlatformProjectID,
		Name:           "Platform",
		PreviewOrigins: []string{},
	}

	pool.EXPECT().Statements().Return(stmts).Times(2)
	gomock.InOrder(
		stmts.EXPECT().CreateProject(gomock.Any(), wantProject).Return(nil),
		stmts.EXPECT().CreateProject(gomock.Any(), wantProject).
			Return(database.NewUniqueError("projects", "projects_pkey", nil)),
	)

	require.NoError(t, Ensure(t.Context(), pool, true))
	require.NoError(t, Ensure(t.Context(), pool, true))
}
