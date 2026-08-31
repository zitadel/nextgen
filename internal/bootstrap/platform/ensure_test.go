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

func TestEnsure(t *testing.T) {
	t.Parallel()
	storageErr := errors.New("connection refused")

	tests := []struct {
		name    string
		enabled bool
		// expect declares the calls the case allows; an unexpected CreateWithID
		// fails the test on its own.
		expect  func(*servicemocks.MockProjectService)
		wantErr error
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
			name:    "existing platform project is accepted",
			enabled: true,
			expect: func(projects *servicemocks.MockProjectService) {
				expectCreate(projects).Return(nil, database.NewUniqueError("projects", "projects_pkey", nil))
			},
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

			err := Ensure(t.Context(), projects, tt.enabled)
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

	require.NoError(t, Ensure(t.Context(), projects, true))
	require.NoError(t, Ensure(t.Context(), projects, true))
}
