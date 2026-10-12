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

	// clock_timestamp, not now(), which is the transaction's start.
	clockStmt            = `SELECT clock_timestamp()`
	createDeploymentStmt = `INSERT INTO zitadel_nextgen.deployments` +
		` (project_id, id, release_id, target_kind, metadata, deployed_at) VALUES ($1, $2, $3, $4, $5, $6)`
	createDeploymentTargetsStmt = `INSERT INTO zitadel_nextgen.deployment_targets` +
		` (project_id, deployment_id, origin, release_id, deployed_at, seq)` +
		` SELECT $1, $2, o.origin, $3, $4, o.seq FROM unnest($5::text[], $6::bigint[]) AS o(origin, seq)`
	deploymentQuery = `SELECT project_id, id, release_id, target_kind, metadata, deployed_at FROM zitadel_nextgen.deployments`
	targetsQuery    = `SELECT origin, deployment_id, release_id, deployed_at, seq FROM zitadel_nextgen.deployment_targets` +
		` WHERE project_id = $1 AND deployment_id = ANY($2)`
	newestDeploymentStmt = deploymentQuery + ` WHERE project_id = $1 AND id = (` +
		`SELECT t.deployment_id FROM zitadel_nextgen.deployment_targets t` +
		` WHERE t.project_id = $1 AND t.origin = $2 ORDER BY t.seq DESC LIMIT 1)`
	deploymentAtStmt = deploymentQuery + ` WHERE project_id = $1 AND id = (` +
		`SELECT t.deployment_id FROM zitadel_nextgen.deployment_targets t` +
		` WHERE t.project_id = $1 AND t.origin = $2 AND t.deployed_at <= $3 ORDER BY t.seq DESC LIMIT 1)`
)

var (
	deploymentSchema = deployment.NewSchema(deploymentsTable, targetsTable, previewsTable)

	newestTargetsStmt = `SELECT t.origin, t.deployment_id, t.release_id, t.deployed_at, t.seq FROM zitadel_nextgen.deployment_targets t` +
		` WHERE t.project_id = $1 AND t.origin = ANY($2) AND NOT ` + deployment.NewerTargetExists(targetsTable)
	liveTargetsStmt = `SELECT t.origin, t.deployment_id, t.release_id, t.deployed_at, t.seq FROM zitadel_nextgen.deployment_targets t` +
		` JOIN zitadel_nextgen.deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = $1 AND t.deployment_id = ANY($2) AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt("d", previewsTable) + `$3))`
	// The origin's newest row, checked as serving on that same row.
	liveDeploymentStmt = deploymentQuery + ` WHERE project_id = $1 AND id = (` +
		`SELECT t.deployment_id FROM zitadel_nextgen.deployment_targets t` +
		` JOIN zitadel_nextgen.deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = $1 AND t.origin = $2 AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt("d", previewsTable) + `$3)))`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(client queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{client: client}}
}

// NewestTargets implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestTargets(ctx context.Context, projectID string, origins []string) ([]domain.TargetDeployment, error) {
	return ds.collectTargets(ctx, ds.client, newestTargetsStmt, projectID, origins)
}

// InsertDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) InsertDeployment(ctx context.Context, entity *domain.Deployment, read []domain.TargetDeployment) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return err
	}
	metadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	var deployedAt time.Time
	err = withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		var now time.Time
		if err := tx.QueryRow(ctx, clockStmt).Scan(&now); err != nil {
			return wrapError(err)
		}
		deployedAt = deployment.Stamp(now)
		if _, err := tx.Exec(ctx, createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, entity.TargetKind.String(), metadata, deployedAt,
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createDeploymentTargetsStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, deployedAt, entity.Origins(), deployment.NextSeqs(entity.Origins(), read),
		); err != nil {
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID))
	})
	if err != nil {
		return err
	}
	entity.DeployedAt = deployedAt
	return nil
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
			database.Equal(database.Col(domain.DeploymentFieldID), id),
		),
	}, deploymentSchema); err != nil {
		return nil, err
	}
	return ds.getOne(ctx, compiler.String(), compiler.args...)
}

// LiveDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) LiveDeployment(ctx context.Context, projectID, origin string, now time.Time) (*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, liveDeploymentStmt, projectID, origin, now)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	if err := ds.attachTargets(ctx, projectID, []*domain.Deployment{entity}, &now); err != nil {
		return nil, err
	}
	return entity, nil
}

// NewestDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	return ds.getOne(ctx, newestDeploymentStmt, projectID, origin)
}

// DeploymentAt implements [service.DeploymentStatements].
func (ds deploymentStatements) DeploymentAt(ctx context.Context, projectID, origin string, at time.Time) (*domain.Deployment, error) {
	return ds.getOne(ctx, deploymentAtStmt, projectID, origin, at)
}

func (ds deploymentStatements) getOne(ctx context.Context, query string, args ...any) (*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	if err := ds.attachTargets(ctx, entity.ProjectID, []*domain.Deployment{entity}, nil); err != nil {
		return nil, err
	}
	return entity, nil
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
	if err := ds.attachTargets(ctx, projectID, items, nil); err != nil {
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

// list pages deployments and attaches their targets: all of them, or with
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
		if err := ds.attachTargets(ctx, items[0].ProjectID, items, liveAt); err != nil {
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

func (ds deploymentStatements) attachTargets(ctx context.Context, projectID string, items []*domain.Deployment, liveAt *time.Time) error {
	ids := deployment.DeploymentIDs(items)
	var (
		rows []domain.TargetDeployment
		err  error
	)
	if liveAt != nil {
		rows, err = ds.collectTargets(ctx, ds.client, liveTargetsStmt, projectID, ids, *liveAt)
	} else {
		rows, err = ds.collectTargets(ctx, ds.client, targetsQuery, projectID, ids)
	}
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, rows)
	return nil
}

func (ds deploymentStatements) collectTargets(ctx context.Context, client queryExecutor, query string, args ...any) ([]domain.TargetDeployment, error) {
	rows, err := client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.TargetDeployment, error) {
		var scanned domain.TargetDeployment
		if err := row.Scan(&scanned.Origin, &scanned.DeploymentID, &scanned.ReleaseID, &scanned.DeployedAt, &scanned.Seq); err != nil {
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
