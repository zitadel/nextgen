package service

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/preview"
)

type ListPreviewsInput struct {
	ProjectID string
	PageToken string
	Limit     int
}

type ListPreviewsOutput struct {
	Items         []*domain.Preview
	NextPageToken string
}

// ListPreviews lists the project's live previews, newest first.
func (s *DeploymentService) ListPreviews(ctx context.Context, input ListPreviewsInput) (_ *ListPreviewsOutput, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.ListPreviews")
	defer end(&err)

	opts := preview.LiveListOptions(input.ProjectID, time.Now(), uint32(normalizeLimit(input.Limit)))
	opts.Pagination.Cursor = []byte(input.PageToken)

	result, err := s.v2Pool.Statements().ListPreviews(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list previews")
	}
	return &ListPreviewsOutput{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// RemovePreview ends a preview at once. Idempotent: an origin with no
// live preview is not an error, and an expired one is left for the sweep. The deployments to it stay in the history.
func (s *DeploymentService) RemovePreview(ctx context.Context, projectID, origin string) (err error) {
	ctx, end := startSpan(ctx, "DeploymentService.RemovePreview")
	defer end(&err)

	return s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		deleted, err := tx.Statements().DeleteLivePreview(ctx, projectID, origin, time.Now())
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to delete preview")
		}
		if !deleted {
			return nil
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypePreviewRemoved,
			Category:   domain.EventCategoryEntity,
			ProjectID:  projectID,
			EntityType: "preview",
			EntityID:   origin,
			Payload:    domain.PreviewPayload{Origin: origin},
		})
	})
}
