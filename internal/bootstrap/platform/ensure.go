// Package platform bootstraps deployment-level platform resources at server
// startup. Today that is the single, flag-gated platform project row (#605):
// when explicitly enabled, the server idempotently ensures the project pinned
// by platform.project_id exists. Disabled (the default) is a no-op, so no
// deployment gets a platform project created silently.
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

// errMissingProjectID guards the enabled-but-unpinned case. Config validation
// (cmd/server) already rejects it; this is defense in depth so a direct caller
// cannot ask for a bootstrap without naming the project.
var errMissingProjectID = errors.New("platform bootstrap: enabled without a project id")

// Ensure idempotently creates the platform project row when enabled.
// Disabled (the default) is a no-op.
func Ensure(ctx context.Context, pool service.StatementPool, enabled bool, projectID string) error {
	if !enabled {
		return nil
	}
	if projectID == "" {
		return errMissingProjectID
	}

	err := pool.Statements().CreateProject(ctx, &domain.Project{
		ID:             projectID,
		Name:           "Platform",
		PreviewOrigins: []string{},
	})
	if err != nil {
		// A duplicate primary key means another replica (or a previous start)
		// already created the row, which is the idempotent success path.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			slog.Info("platform bootstrap: platform project already exists", slog.String("project_id", projectID))
			return nil
		}
		return fmt.Errorf("ensure platform project %q: %w", projectID, err)
	}

	slog.Info("platform bootstrap: created platform project", slog.String("project_id", projectID))
	return nil
}
