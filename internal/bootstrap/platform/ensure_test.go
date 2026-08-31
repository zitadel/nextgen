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

// expectCreate declares the one call Ensure is allowed to make. seedDefaults
// must be true: a bare project row satisfies the foreign keys and nothing
// else, so a deployment that bootstrapped one could not serve a registration.
func expectCreate(projects *servicemocks.MockProjectService) *servicemocks.MockProjectServiceCreateWithIDCall {
	return projects.EXPECT().CreateWithID(
		gomock.Any(), domain.PlatformProjectID, "Platform", []string{}, true,
	)
}

// newPool wires a statement pool whose seeded-probe answers with probe. A nil
// probe registers no expectation, so a case that must never reach the check
// fails on the unexpected call.
func newPool(t *testing.T, probe func(*servicemocks.MockAllStatements)) *servicemocks.MockStatementPool {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	if probe == nil {
		return pool
	}
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts)
	probe(stmts)
	return pool
}

// seeded and unseeded are the two answers the token-key probe can give.
func seeded(stmts *servicemocks.MockAllStatements) {
	stmts.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).
		Return(&domain.EncryptionKey{ProjectID: domain.PlatformProjectID}, nil)
}

func unseeded(stmts *servicemocks.MockAllStatements) {
	stmts.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).
		Return(nil, database.NewNoRowFoundError(nil))
}

func TestEnsure(t *testing.T) {
	t.Parallel()
	storageErr := errors.New("connection refused")

	tests := []struct {
		name    string
		enabled bool
		// expect declares the calls the case allows; an unexpected CreateWithID
		// fails the test on its own.
		expect func(*servicemocks.MockProjectService)
		// probe answers the seeded check. Nil means the case must never reach
		// it, which gomock enforces.
		probe func(*servicemocks.MockAllStatements)
		// wantErrMsg matches a plain error with no sentinel to compare against.
		wantErrMsg string
		wantErr    error
	}{
		{
			name:    "disabled is a no-op with no service calls",
			enabled: false,
			expect:  func(*servicemocks.MockProjectService) {},
		},
		{
			name:    "enabled creates the platform project with defaults seeded",
			enabled: true,
			expect: func(projects *servicemocks.MockProjectService) {
				expectCreate(projects).Return(&domain.Project{ID: domain.PlatformProjectID}, nil)
			},
		},
		{
			name:    "existing seeded platform project is accepted",
			enabled: true,
			expect: func(projects *servicemocks.MockProjectService) {
				expectCreate(projects).Return(nil, database.NewUniqueError("projects", "projects_pkey", nil))
			},
			probe: seeded,
		},
		{
			// The row is not proof of seeding: #736's bootstrap inserted a bare
			// project, so a deployment that enabled the flag back then still has
			// one. Accepting the collision would leave it permanently unable to
			// serve a registration, and say nothing about why.
			name:    "existing but unseeded platform project refuses to start",
			enabled: true,
			expect: func(projects *servicemocks.MockProjectService) {
				expectCreate(projects).Return(nil, database.NewUniqueError("projects", "projects_pkey", nil))
			},
			probe:      unseeded,
			wantErrMsg: "exists but was never seeded",
		},
		{
			name:    "a failing seeded check is propagated, not read as unseeded",
			enabled: true,
			expect: func(projects *servicemocks.MockProjectService) {
				expectCreate(projects).Return(nil, database.NewUniqueError("projects", "projects_pkey", nil))
			},
			probe: func(stmts *servicemocks.MockAllStatements) {
				stmts.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(nil, storageErr)
			},
			wantErr: storageErr,
		},
		{
			name: "existing platform project is accepted through the service's error wrapping",
			// The project service reports the collision as an internal domain
			// error carrying the original as its parent, which is the shape
			// this actually sees in production.
			enabled: true,
			expect: func(projects *servicemocks.MockProjectService) {
				expectCreate(projects).Return(nil, domain.ErrInternal(
					database.NewUniqueError("projects", "projects_pkey", nil),
				))
			},
			probe: seeded,
		},
		{
			name:    "other error is propagated wrapped",
			enabled: true,
			expect: func(projects *servicemocks.MockProjectService) {
				expectCreate(projects).Return(nil, storageErr)
			},
			wantErr: storageErr,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			projects := servicemocks.NewMockProjectService(gomock.NewController(t))
			tt.expect(projects)

			err := Ensure(t.Context(), projects, newPool(t, tt.probe), tt.enabled)
			if tt.wantErrMsg != "" {
				require.ErrorContains(t, err, tt.wantErrMsg)
				return
			}
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
		})
	}
}

// TestEnsureIdempotentAcrossRuns runs Ensure twice: the first create succeeds
// and the second reports a duplicate primary key. Both calls must succeed and
// both must ask for the same well-known id, name, and seeding.
func TestEnsureIdempotentAcrossRuns(t *testing.T) {
	t.Parallel()
	projects := servicemocks.NewMockProjectService(gomock.NewController(t))

	gomock.InOrder(
		expectCreate(projects).Return(&domain.Project{ID: domain.PlatformProjectID}, nil).Call,
		expectCreate(projects).Return(nil, database.NewUniqueError("projects", "projects_pkey", nil)).Call,
	)

	require.NoError(t, Ensure(t.Context(), projects, newPool(t, nil), true))
	require.NoError(t, Ensure(t.Context(), projects, newPool(t, seeded), true))
}
