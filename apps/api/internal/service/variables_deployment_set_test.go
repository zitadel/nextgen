package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestVariableService_ReadDeploymentVariableSet(t *testing.T) {
	t.Run("a deployment with no set is not an internal error", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)
		statements.EXPECT().GetDeploymentVariables(gomock.Any(), "proj-1", "dep_1").
			Return(nil, database.NewNoRowFoundError(nil))

		_, err := svc.ReadDeploymentVariableSet(t.Context(), statements, "proj-1", "dep_1")
		require.Error(t, err)
		assert.NotErrorIs(t, err, domain.ErrInternal(nil))
		assert.ErrorContains(t, err, "no frozen variables")
	})
}

func TestVariableService_StoreDeploymentVariableSet(t *testing.T) {
	svc, statements, _, _ := newMockedVariableService(t)
	set, err := domain.NewVariableSet("proj-1", nil)
	require.NoError(t, err)
	gomock.InOrder(
		statements.EXPECT().EnsureVariableSet(gomock.Any(), set).Return(nil),
		statements.EXPECT().LinkDeploymentVariableSet(gomock.Any(), "proj-1", "dep_1", set.Hash).Return(nil),
	)

	require.NoError(t, svc.StoreDeploymentVariableSet(t.Context(), statements, "proj-1", "dep_1", set))
}
