// Package platform bootstraps deployment-level platform resources at server
// startup. Today that is the single, flag-gated platform project (#605): when
// explicitly enabled, the server idempotently ensures the well-known platform
// project (domain.PlatformProjectID) exists, seeded well enough to serve a
// registration and a sign-in. Disabled (the default) is a no-op, so no
// deployment gets a platform project created silently.
package platform

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectCreator is the slice of [service.ProjectService] the bootstrap needs.
type ProjectCreator interface {
	CreateWithID(ctx context.Context, id, name string, previewOrigins []string, seedDefaults bool) (*domain.Project, error)
}

// Ensure idempotently creates the platform project when enabled, with the
// defaults a project needs to be usable: encryption and signing keys, the
// default user schema, and the default login flow definitions. A bare project
// row would satisfy the foreign keys and nothing else, so a deployment that
// bootstrapped one could not actually serve the registration the platform
// plane exists for.
//
// The row carries the well-known domain.PlatformProjectID; the server owns
// that id, so there is nothing for a caller to pass. Disabled (the default) is
// a no-op.
func Ensure(ctx context.Context, projects ProjectCreator, enabled bool) error {
	if !enabled {
		return nil
	}

	_, err := projects.CreateWithID(ctx, domain.PlatformProjectID, "Platform", []string{}, true)
	if err != nil {
		// A duplicate primary key means another replica (or a previous start)
		// already created the project, which is the idempotent success path.
		// Seeding shares that one transaction, so a project row that exists is
		// a project that was seeded; there is no half-provisioned state to
		// repair here.
		// The project service wraps the failure as an internal domain error
		// carrying the original as its parent, so the type still matches
		// through Unwrap.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			slog.Info("platform bootstrap: platform project already exists", slog.String("project_id", domain.PlatformProjectID))
			return nil
		}
		return fmt.Errorf("ensure platform project %q: %w", domain.PlatformProjectID, err)
	}

	slog.Info("platform bootstrap: created platform project with default schema and login flows",
		slog.String("project_id", domain.PlatformProjectID))
	return nil
}
