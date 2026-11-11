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
	"github.com/zitadel/nextgen/internal/storage/database"
)

const previewOrigin = "https://acme-git-sso-acmeinc.vercel.app"

func TestDeploymentServiceListPreviews(t *testing.T) {
	svc, statements := newStrictDeploymentService(t)
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
	svc, statements := newStrictDeploymentService(t)
	statements.EXPECT().DeleteLivePreview(gomock.Any(), "proj_1", previewOrigin, gomock.Any()).Return(true, nil)
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, event *domain.Event) error {
			assert.Equal(t, domain.EventTypePreviewRemoved, event.EventType)
			assert.Equal(t, previewOrigin, *event.EntityID)
			assert.Equal(t, "proj_1", event.ProjectID)
			assert.Equal(t, "preview", *event.EntityType)
			assert.JSONEq(t, `{}`, string(event.Payload))
			return nil
		})

	require.NoError(t, svc.RemovePreview(t.Context(), "proj_1", previewOrigin))
}

// No preview to remove is not an error, and nothing is audited.
func TestDeploymentServiceRemovePreviewIsIdempotent(t *testing.T) {
	svc, statements := newStrictDeploymentService(t)
	statements.EXPECT().DeleteLivePreview(gomock.Any(), "proj_1", previewOrigin, gomock.Any()).Return(false, nil)

	require.NoError(t, svc.RemovePreview(t.Context(), "proj_1", previewOrigin))
}

func TestDeploymentServiceRemovePreviewStorageError(t *testing.T) {
	svc, statements := newStrictDeploymentService(t)
	statements.EXPECT().DeleteLivePreview(gomock.Any(), "proj_1", previewOrigin, gomock.Any()).Return(false, errors.New("boom"))

	err := svc.RemovePreview(t.Context(), "proj_1", previewOrigin)
	de, ok := errors.AsType[domain.Error](err)
	require.True(t, ok, err)
	assert.Equal(t, domain.ErrInternal(nil).Code, de.Code)
}
