package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	deploymentsTable = "deployments"
	targetsTable     = "deployment_targets"
	previewsTable    = "previews"

	// No FOR UPDATE: SQLite has one writer, and _txlock=immediate takes the
	// write lock at BEGIN, so the transaction itself serializes deploys and
	// revokes. The read keeps a missing project a NoRowFoundError.
	lockProjectStmt      = `SELECT id FROM projects WHERE id = ?`
	createDeploymentStmt = `INSERT INTO deployments` +
		` (project_id, id, release_id, target_kind, metadata, deployed_at) VALUES (?, ?, ?, ?, ?, ?)`
	// Sets of origins and ids bind as one JSON array, read back by json_each.
	createDeploymentTargetsStmt = `INSERT INTO deployment_targets` +
		` (project_id, deployment_id, origin, release_id, deployed_at)` +
		` SELECT ?, ?, value, ?, ? FROM json_each(?)`
	// See the postgres statement.
	upsertPreviewsStmt = `INSERT INTO previews (project_id, origin, expires_at, created_at)` +
		` SELECT ?, value, ?, ? FROM json_each(?) WHERE true` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = excluded.expires_at`
	deploymentQuery = `SELECT project_id, id, release_id, target_kind, metadata, deployed_at FROM deployments`
	targetsQuery    = `SELECT deployment_id, origin, release_id, deployed_at FROM deployment_targets` +
		` WHERE project_id = ? AND deployment_id IN (SELECT value FROM json_each(?))`
	// See the postgres statements.
	newestDeploymentStmt = deploymentQuery + ` WHERE project_id = ?1 AND id = (` +
		`SELECT t.deployment_id FROM deployment_targets t` +
		` WHERE t.project_id = ?1 AND t.origin = ?2` +
		` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1)`
	deploymentAtStmt = deploymentQuery + ` WHERE project_id = ?1 AND id = (` +
		`SELECT t.deployment_id FROM deployment_targets t` +
		` WHERE t.project_id = ?1 AND t.origin = ?2 AND t.deployed_at <= ?3` +
		` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1)`
)

var (
	deploymentSchema = deployment.NewSchema(deploymentsTable, targetsTable, previewsTable)

	// See the postgres statements.
	newestTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM deployment_targets t` +
		` WHERE t.project_id = ? AND t.origin IN (SELECT value FROM json_each(?)) AND NOT ` + deployment.NewerTargetExists(targetsTable)
	liveTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = ? AND t.deployment_id IN (SELECT value FROM json_each(?)) AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt(previewsTable) + `?))`
	servingTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = ? AND t.release_id = ? AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt(previewsTable) + `?))` +
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

func jsonArray(values []string) (string, error) {
	encoded, err := json.Marshal(values)
	return string(encoded), err
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
	encodedOrigins, err := jsonArray(origins)
	if err != nil {
		return false, err
	}
	// See the postgres statement for why the answer is staged.
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
		newest, err := ds.collectTargets(ctx, tx, newestTargetsStmt, entity.ProjectID, encodedOrigins)
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

		// Stamped inside the transaction, which holds the write lock, so a
		// deploy that waited for another stamps after it.
		deployedAt = deployment.Stamp(time.Now(), deployment.StampFloor(top))
		if _, err := tx.Exec(ctx, createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, entity.TargetKind.String(), string(metadata), deployedAt.UnixNano(),
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createDeploymentTargetsStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, deployedAt.UnixNano(), encodedOrigins,
		); err != nil {
			return wrapError(err)
		}
		if entity.TargetKind == domain.DeploymentTargetKindPreview {
			expiresAt := deployedAt.Add(previewTTL).Truncate(time.Microsecond)
			if _, err := tx.Exec(ctx, upsertPreviewsStmt,
				entity.ProjectID, expiresAt.UnixNano(), deployedAt.UnixNano(), encodedOrigins,
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
	entity, err := collectExactlyOneRow(rows, scanDeployment)
	rows.Close()
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
	return ds.getOne(ctx, ds.client, deploymentAtStmt, projectID, origin, at.UnixNano())
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
	defer rows.Close()
	items, err := collectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// attachTargets reads the target rows of items in one round trip: every row,
// or with liveAt only the rows still serving then.
func (ds deploymentStatements) attachTargets(ctx context.Context, client queryExecutor, projectID string, items []*domain.Deployment, liveAt *time.Time) error {
	ids, err := jsonArray(deployment.DeploymentIDs(items))
	if err != nil {
		return err
	}
	var rows []deployment.TargetRow
	if liveAt != nil {
		rows, err = ds.collectTargets(ctx, client, liveTargetsStmt, projectID, ids, liveAt.UnixNano())
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
	defer rows.Close()
	items, err := collectRows(rows, func(rows *sql.Rows) (deployment.TargetRow, error) {
		var (
			scanned      deployment.TargetRow
			deployedNano int64
		)
		if err := rows.Scan(&scanned.DeploymentID, &scanned.Origin, &scanned.ReleaseID, &deployedNano); err != nil {
			return scanned, err
		}
		scanned.DeployedAt = timeFromUnixNano(deployedNano)
		return scanned, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func scanDeployment(rows *sql.Rows) (*domain.Deployment, error) {
	var (
		scanned      deployment.Row
		metadata     string
		deployedNano int64
	)
	if err := rows.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.ReleaseID,
		&scanned.TargetKind,
		&metadata,
		&deployedNano,
	); err != nil {
		return nil, err
	}
	scanned.Metadata = []byte(metadata)
	scanned.DeployedAt = timeFromUnixNano(deployedNano)
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
