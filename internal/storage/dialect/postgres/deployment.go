package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	deploymentsTable = "zitadel_nextgen.deployments"
	targetsTable     = "zitadel_nextgen.deployment_targets"
	previewsTable    = "zitadel_nextgen.previews"

	// Serializes the writes that decide what a project's targets serve:
	// deploys, and revokes, which must not race a deploy of the release they
	// refuse. The second waits for the first and then reads its rows.
	//
	// FOR NO KEY UPDATE, not FOR UPDATE: inserting any row that references
	// the project takes FOR KEY SHARE on it, which FOR UPDATE would block for
	// as long as the deploy runs — every sign-in of the project included.
	// FOR NO KEY UPDATE still conflicts with itself, so deploys and revokes
	// still queue.
	lockProjectStmt = `SELECT id FROM zitadel_nextgen.projects WHERE id = $1 FOR NO KEY UPDATE`
	// clock_timestamp, not now(): now() is the transaction's start, and a
	// deploy that waited on the lock has to stamp after the one it waited for.
	clockStmt            = `SELECT clock_timestamp()`
	createDeploymentStmt = `INSERT INTO zitadel_nextgen.deployments` +
		` (project_id, id, release_id, target_kind, metadata, deployed_at) VALUES ($1, $2, $3, $4, $5, $6)`
	createDeploymentTargetsStmt = `INSERT INTO zitadel_nextgen.deployment_targets` +
		` (project_id, deployment_id, origin, release_id, deployed_at)` +
		` SELECT $1, $2, origin, $3, $4 FROM unnest($5::text[]) AS origin`
	// A renewal moves the expiry and keeps created_at, the first deploy.
	upsertPreviewsStmt = `INSERT INTO zitadel_nextgen.previews (project_id, origin, expires_at, created_at)` +
		` SELECT $1, origin, $2, $3 FROM unnest($4::text[]) AS origin` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = EXCLUDED.expires_at`
	deploymentQuery = `SELECT project_id, id, release_id, target_kind, metadata, deployed_at FROM zitadel_nextgen.deployments`
	targetsQuery    = `SELECT deployment_id, origin, release_id, deployed_at FROM zitadel_nextgen.deployment_targets` +
		` WHERE project_id = $1 AND deployment_id = ANY($2)`
	// The deployment an origin serves, or served at $3: its newest target row
	// no later than that, joined back to the operation.
	newestDeploymentStmt = deploymentQuery + ` WHERE project_id = $1 AND id = (` +
		`SELECT t.deployment_id FROM zitadel_nextgen.deployment_targets t` +
		` WHERE t.project_id = $1 AND t.origin = $2` +
		` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1)`
	deploymentAtStmt = deploymentQuery + ` WHERE project_id = $1 AND id = (` +
		`SELECT t.deployment_id FROM zitadel_nextgen.deployment_targets t` +
		` WHERE t.project_id = $1 AND t.origin = $2 AND t.deployed_at <= $3` +
		` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1)`
)

var (
	deploymentSchema = deployment.NewSchema(deploymentsTable, targetsTable, previewsTable)

	// The newest row of each named origin: what each serves.
	newestTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM zitadel_nextgen.deployment_targets t` +
		` WHERE t.project_id = $1 AND t.origin = ANY($2) AND NOT ` + deployment.NewerTargetExists(targetsTable)
	// The target rows of the named deployments that still serve at $3.
	liveTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM zitadel_nextgen.deployment_targets t` +
		` JOIN zitadel_nextgen.deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = $1 AND t.deployment_id = ANY($2) AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt(previewsTable) + `$3))`
	// The origins still serving release $2 at $3.
	servingTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM zitadel_nextgen.deployment_targets t` +
		` JOIN zitadel_nextgen.deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = $1 AND t.release_id = $2 AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt(previewsTable) + `$3))` +
		` ORDER BY t.origin`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(client queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{client: client}}
}

func lockProject(ctx context.Context, tx queryExecutor, projectID string) error {
	var locked string
	return wrapError(tx.QueryRow(ctx, lockProjectStmt, projectID).Scan(&locked))
}

// CreateDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment, expectedDeploymentID *string, previewTTL time.Duration) (created bool, err error) {
	if entity.TargetKind == domain.DeploymentTargetKindPreview && previewTTL <= 0 {
		return false, domain.ErrDeploymentInvalid("a deployment to preview URLs needs a ttl", nil)
	}
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return false, err
	}
	metadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return false, err
	}
	origins := entity.Origins()
	// The idempotent answer and the stamp are staged here and copied onto
	// the entity only after the transaction commits: the callback must stay
	// replayable, and overwriting the entity inside an attempt that later
	// aborts would make the retry compare — and insert — with another
	// deployment's values.
	var (
		existing   *domain.Deployment
		deployedAt time.Time
	)
	err = withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		created = false
		existing = nil
		if err := lockProject(ctx, tx, entity.ProjectID); err != nil {
			return err
		}
		newest, err := ds.collectTargets(ctx, tx, newestTargetsStmt, entity.ProjectID, origins)
		if err != nil {
			return err
		}
		top := deployment.Newest(newest)
		var current *domain.Deployment
		if top != nil {
			if current, err = ds.getInTx(ctx, tx, entity.ProjectID, top.DeploymentID); err != nil {
				return err
			}
		}
		if err := deployment.CheckExpected(current, expectedDeploymentID); err != nil {
			return err
		}
		if deployment.Unchanged(entity, newest) {
			existing = current
			return nil
		}

		var now time.Time
		if err := tx.QueryRow(ctx, clockStmt).Scan(&now); err != nil {
			return wrapError(err)
		}
		deployedAt = deployment.Stamp(now, deployment.StampFloor(top))
		if _, err := tx.Exec(ctx, createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, entity.TargetKind.String(), metadata, deployedAt,
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createDeploymentTargetsStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, deployedAt, origins,
		); err != nil {
			return wrapError(err)
		}
		if entity.TargetKind == domain.DeploymentTargetKindPreview {
			expiresAt := deployedAt.Add(previewTTL).Truncate(time.Microsecond)
			if _, err := tx.Exec(ctx, upsertPreviewsStmt,
				entity.ProjectID, expiresAt, deployedAt, origins,
			); err != nil {
				return wrapError(err)
			}
		}
		created = true
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID))
	})
	if err != nil {
		return false, err
	}
	if existing != nil {
		*entity = *existing
	} else {
		entity.DeployedAt = deployedAt
	}
	return created, nil
}

// getInTx reads one deployment with every target it named.
func (ds deploymentStatements) getInTx(ctx context.Context, tx queryExecutor, projectID, id string) (*domain.Deployment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
			database.Equal(database.Col(domain.DeploymentFieldID), id),
		),
	}, deploymentSchema); err != nil {
		return nil, err
	}
	return ds.getOne(ctx, tx, compiler.String(), compiler.args...)
}

func (ds deploymentStatements) getOne(ctx context.Context, client queryExecutor, query string, args ...any) (*domain.Deployment, error) {
	rows, err := client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	if err := ds.attachTargets(ctx, client, entity.ProjectID, []*domain.Deployment{entity}, nil); err != nil {
		return nil, err
	}
	return entity, nil
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	return ds.getInTx(ctx, ds.client, projectID, id)
}

// NewestDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	return ds.getOne(ctx, ds.client, newestDeploymentStmt, projectID, origin)
}

// DeploymentAt implements [service.DeploymentStatements].
func (ds deploymentStatements) DeploymentAt(ctx context.Context, projectID, origin string, at time.Time) (*domain.Deployment, error) {
	return ds.getOne(ctx, ds.client, deploymentAtStmt, projectID, origin, at)
}

// GetDeploymentsByIDs implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentsByIDs(ctx context.Context, projectID string, ids []string) ([]*domain.Deployment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: deployment.ByIDs(projectID, ids),
	}, deploymentSchema); err != nil {
		return nil, err
	}
	items, err := ds.collect(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, err
	}
	if err := ds.attachTargets(ctx, ds.client, projectID, items, nil); err != nil {
		return nil, err
	}
	return items, nil
}

// ListDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListDeployments(ctx context.Context, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	return ds.list(ctx, filter, nil)
}

// ListLiveDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListLiveDeployments(ctx context.Context, now time.Time, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	return ds.list(ctx, filter, &now)
}

// list pages deployments and attaches their targets: every target, or with
// liveAt only those still serving then.
func (ds deploymentStatements) list(ctx context.Context, filter *database.ListOptions[domain.DeploymentField], liveAt *time.Time) (*database.ListResult[*domain.Deployment], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, deploymentSchema, func(limit uint32) ([]*domain.Deployment, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, deploymentQuery, filter, deploymentSchema, deploymentsTable, "id"); err != nil {
			return nil, err
		}
		return ds.collect(ctx, compiler.String(), compiler.args...)
	})
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		if err := ds.attachTargets(ctx, ds.client, items[0].ProjectID, items, liveAt); err != nil {
			return nil, err
		}
	}
	return &database.ListResult[*domain.Deployment]{Items: items, NextCursor: nextCursor}, nil
}

func (ds deploymentStatements) collect(ctx context.Context, query string, args ...any) ([]*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// attachTargets reads the target rows of items in one round trip: every row,
// or with liveAt only the rows still serving then.
func (ds deploymentStatements) attachTargets(ctx context.Context, client queryExecutor, projectID string, items []*domain.Deployment, liveAt *time.Time) error {
	ids := deployment.DeploymentIDs(items)
	var (
		rows []deployment.TargetRow
		err  error
	)
	if liveAt != nil {
		rows, err = ds.collectTargets(ctx, client, liveTargetsStmt, projectID, ids, *liveAt)
	} else {
		rows, err = ds.collectTargets(ctx, client, targetsQuery, projectID, ids)
	}
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, rows)
	return nil
}

func (ds deploymentStatements) collectTargets(ctx context.Context, client queryExecutor, query string, args ...any) ([]deployment.TargetRow, error) {
	rows, err := client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (deployment.TargetRow, error) {
		var scanned deployment.TargetRow
		if err := row.Scan(&scanned.DeploymentID, &scanned.Origin, &scanned.ReleaseID, &scanned.DeployedAt); err != nil {
			return scanned, err
		}
		scanned.DeployedAt = scanned.DeployedAt.UTC()
		return scanned, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func scanDeployment(row pgx.CollectableRow) (*domain.Deployment, error) {
	var scanned deployment.Row
	if err := row.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.ReleaseID,
		&scanned.TargetKind,
		&scanned.Metadata,
		&scanned.DeployedAt,
	); err != nil {
		return nil, err
	}
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
