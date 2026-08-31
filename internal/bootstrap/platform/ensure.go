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
	"github.com/zitadel/nextgen/internal/service"
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
func Ensure(ctx context.Context, projects ProjectCreator, pool service.StatementPool, enabled bool) error {
	if !enabled {
		return nil
	}

	_, err := projects.CreateWithID(ctx, domain.PlatformProjectID, "Platform", []string{}, true)
	if err != nil {
		// A duplicate primary key means another replica (or a previous start)
		// already created the project. The project service wraps the failure as
		// an internal domain error carrying the original as its parent, so the
		// type still matches through Unwrap.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return confirmSeeded(ctx, pool)
		}
		return fmt.Errorf("ensure platform project %q: %w", domain.PlatformProjectID, err)
	}

	slog.Info("platform bootstrap: created platform project with default schema and login flows",
		slog.String("project_id", domain.PlatformProjectID))
	return nil
}

// confirmSeeded checks that a pre-existing platform project actually carries
// what a registration needs, rather than assuming the row implies it.
//
// The row is not proof of seeding. The first version of this bootstrap (#736)
// inserted a bare project with no keys, no user schema and no login flows, so
// every deployment that enabled the flag before seeding existed still has one.
// Treating the collision as success would leave those permanently unusable, and
// silently: the project resolves as the default, and every registration and
// exchange against it fails somewhere further in.
//
// The probe is an active token key: it is what the session exchange reaches
// for first, and the bare row this targets has none. That is a detector for
// the case at hand, not a full health check — it does not verify the signing
// key, the user schema, or the login flows. Everything this bootstrap seeds
// shares one transaction, so a project it created has all of them or none, and
// a project it did not create is the bare row. A project assembled some other
// way could still pass; validating each resource belongs with in-place seeding
// (#527's provisioner), which is the real fix and is not implemented here.
func confirmSeeded(ctx context.Context, pool service.StatementPool) error {
	_, err := pool.Statements().GetEncryptionKey(ctx, database.And(
		database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), domain.PlatformProjectID),
		database.Equal(database.Col(domain.EncryptionKeyFieldPurpose), string(domain.EncryptionKeyPurposeToken)),
		database.Equal(database.Col(domain.EncryptionKeyFieldState), string(domain.KeyStateActive)),
	))
	if err == nil {
		slog.Info("platform bootstrap: platform project already exists", slog.String("project_id", domain.PlatformProjectID))
		return nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return fmt.Errorf("check platform project %q for encryption keys: %w", domain.PlatformProjectID, err)
	}
	// Refusing to start is deliberate. The alternative is booting a deployment
	// whose platform project cannot serve the registration it exists for, and
	// failing here names the problem once instead of leaving it to be diagnosed
	// from whatever breaks downstream.
	//
	// The remedy deliberately does not mention deleting the project. Its
	// children cascade — users, teams, schemas, sessions, branding, grants — and
	// this check exists to greet *existing* deployments, which are the ones with
	// data to lose. Turning the flag back off restores the pre-upgrade behaviour
	// without touching a row.
	return fmt.Errorf(
		"platform project %q exists but has no active token encryption key, so it was created by a bootstrap that predates seeding "+
			"and cannot serve a registration. Seeding an existing project in place is not implemented yet (#527); "+
			"until it is, unset platform.bootstrap_project to start with the pre-upgrade behaviour. "+
			"Do not delete the project to force a reseed: that cascades to its users, teams, schemas and sessions",
		domain.PlatformProjectID)
}
