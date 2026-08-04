// Package platform bootstraps deployment-level platform resources at server
// startup. Today that is the single, flag-gated platform project row (#605):
// when explicitly enabled, the server idempotently ensures the well-known
// platform project (domain.PlatformProjectID) exists. Disabled (the default)
// is a no-op, so no deployment gets a platform project created silently.
package platform

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Ensure idempotently creates the platform project row when enabled. The row
// carries the well-known domain.PlatformProjectID; the server owns that id, so
// there is nothing for a caller to pass. Disabled (the default) is a no-op.
func Ensure(ctx context.Context, pool service.StatementPool, enabled bool) error {
	if !enabled {
		return nil
	}

	err := pool.Statements().CreateProject(ctx, &domain.Project{
		ID:             domain.PlatformProjectID,
		Name:           "Platform",
		PreviewOrigins: []string{},
	})
	if err != nil {
		// A duplicate primary key means another replica (or a previous start)
		// already created the row, which is the idempotent success path.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			slog.Info("platform bootstrap: platform project already exists", slog.String("project_id", domain.PlatformProjectID))
			return nil
		}
		return fmt.Errorf("ensure platform project %q: %w", domain.PlatformProjectID, err)
	}

	slog.Info("platform bootstrap: created platform project", slog.String("project_id", domain.PlatformProjectID))
	return nil
}
