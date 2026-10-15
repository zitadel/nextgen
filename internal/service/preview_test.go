package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const previewOrigin = "https://acme-git-sso-acmeinc.vercel.app"

func newMockedPreviewService(t *testing.T) (*service.DeploymentService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewDeploymentService(service.NewPool(pool)), statements
}

func TestDeploymentServiceListPreviews(t *testing.T) {
	svc, statements := newMockedPreviewService(t)
	live := &domain.Preview{ProjectID: "proj_1", Origin: previewOrigin, ExpiresAt: time.Now().Add(time.Hour)}
	statements.EXPECT().ListPreviews(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.PreviewField]) (*database.ListResult[*domain.Preview], error) {
			assert.Equal(t, []byte("cursor"), opts.Pagination.Cursor)
			return &database.ListResult[*domain.Preview]{Items: []*domain.Preview{live}, NextCursor: []byte("next")}, nil
		})

	result, err := svc.ListPreviews(t.Context(), service.ListPreviewsInput{ProjectID: "proj_1", PageToken: "cursor"})
	require.NoError(t, err)
	assert.Equal(t, []*domain.Preview{live}, result.Items)
	assert.Equal(t, "next", result.NextPageToken)
}

func TestDeploymentServiceRemovePreviewAuditsRemoval(t *testing.T) {
	svc, statements := newMockedPreviewService(t)
	statements.EXPECT().DeletePreview(gomock.Any(), "proj_1", previewOrigin).Return(true, nil)
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, event *domain.Event) error {
			assert.Equal(t, domain.EventTypePreviewRemoved, event.EventType)
			assert.Equal(t, previewOrigin, *event.EntityID)
			return nil
		})

	require.NoError(t, svc.RemovePreview(t.Context(), "proj_1", previewOrigin))
}

// No preview to remove is not an error, and nothing is audited.
func TestDeploymentServiceRemovePreviewIsIdempotent(t *testing.T) {
	svc, statements := newMockedPreviewService(t)
	statements.EXPECT().DeletePreview(gomock.Any(), "proj_1", previewOrigin).Return(false, nil)

	require.NoError(t, svc.RemovePreview(t.Context(), "proj_1", previewOrigin))
}

func TestDeploymentServiceRemovePreviewStorageError(t *testing.T) {
	svc, statements := newMockedPreviewService(t)
	statements.EXPECT().DeletePreview(gomock.Any(), "proj_1", previewOrigin).Return(false, errors.New("boom"))

	err := svc.RemovePreview(t.Context(), "proj_1", previewOrigin)
	de, ok := errors.AsType[domain.Error](err)
	require.True(t, ok, err)
	assert.Equal(t, domain.ErrInternal(nil).Code, de.Code)
}
