package api

import (
	"context"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// GetOAuthSettings answers that no revision has the ID. A release is the only
// writer of OAuth settings and buildRelease refuses a bundle that carries
// them until the release service stores them, so no revision exists to read.
func (h *Handler) GetOAuthSettings(ctx context.Context, params api.GetOAuthSettingsParams) (api.GetOAuthSettingsRes, error) {
	return nil, domain.ErrOAuthSettingsNotFound()
}
