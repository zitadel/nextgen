package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	deploymentTable = "deployments"
	targetsTable    = "deployment_targets"
	previewTable    = "previews"

	deploymentQuery = `SELECT project_id, id, release_id, target_kind, metadata, deployed_at FROM deployments`
	targetsQuery    = `SELECT t.origin, t.deployment_id, t.release_id, d.target_kind, t.deployed_at, t.seq FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = @p1 AND t.deployment_id IN UNNEST(@p2)`
)

var (
	deploymentSchema = deployment.NewSchema(deploymentTable, targetsTable, previewTable)

	deploymentColumns = []string{"project_id", "id", "release_id", "target_kind", "metadata", "deployed_at"}
	targetColumns     = []string{"project_id", "deployment_id", "origin", "release_id", "deployed_at", "seq"}

	newestTargetsStmt = `SELECT t.origin, t.deployment_id, t.release_id, d.target_kind, t.deployed_at, t.seq FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = @p1 AND t.origin IN UNNEST(@p2) AND NOT ` + deployment.NewerTargetExists(targetsTable)
	liveTargetsStmt = `SELECT t.origin, t.deployment_id, t.release_id, d.target_kind, t.deployed_at, t.seq FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = @p1 AND t.deployment_id IN UNNEST(@p2) AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt("d", previewTable) + `@p3))`
	// See the postgres statement.
	liveDeploymentStmt = deploymentQuery + ` WHERE project_id = @p1 AND id = (` +
		`SELECT t.deployment_id FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = @p1 AND t.origin = @p2 AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt("d", previewTable) + `@p3)))`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(db queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{db: db}}
}

// GetNewestTargets implements [service.DeploymentStatements].
func (ds deploymentStatements) GetNewestTargets(ctx context.Context, projectID string, origins []string) ([]domain.TargetDeployment, error) {
	return ds.collectTargets(ctx, newestTargetsStmt, projectID, origins)
}

// CreateDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment, read []domain.TargetDeployment) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return err
	}
	rawMetadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	metadata, err := encodeNullJSON(rawMetadata)
	if err != nil {
		return err
	}
	var deployedAt time.Time
	err = withTransaction(ctx, ds.db, func(ctx context.Context, tx queryExecutor) error {
		deployedAt = deployment.Stamp(time.Now())
		mutations := []*spanner.Mutation{
			spanner.Insert(deploymentTable, deploymentColumns, []any{
				entity.ProjectID, entity.ID, entity.ReleaseID, entity.TargetKind.String(), metadata, deployedAt,
			}),
		}
		origins := entity.Origins()
		for i, seq := range deployment.NextSeqs(origins, read) {
			mutations = append(mutations, spanner.Insert(targetsTable, targetColumns,
				[]any{entity.ProjectID, entity.ID, origins[i], entity.ReleaseID, deployedAt, seq}))
		}
		if err := tx.BufferWrite(ctx, mutations); err != nil {
			return err
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
	row, err := ds.db.ReadRow(ctx, deploymentTable, spanner.Key{projectID, id}, deploymentColumns)
	if err != nil {
		return nil, err
	}
	entity, err := scanDeployment(row)
	if err != nil {
		return nil, err
	}
	if err := ds.attachTargets(ctx, projectID, []*domain.Deployment{entity}, nil); err != nil {
		return nil, err
	}
	return entity, nil
}

// GetLiveDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) GetLiveDeployment(ctx context.Context, projectID, origin string, now time.Time) (*domain.Deployment, error) {
	var entity *domain.Deployment
	if err := ds.db.Query(ctx, buildStatement(liveDeploymentStmt, projectID, origin, now).statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, err
	}
	if err := ds.attachTargets(ctx, projectID, []*domain.Deployment{entity}, &now); err != nil {
		return nil, err
	}
	return entity, nil
}

func (ds deploymentStatements) getOne(ctx context.Context, stmt spanner.Statement) (*domain.Deployment, error) {
	var entity *domain.Deployment
	if err := ds.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, err
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
	items, err := ds.collect(ctx, compiler.statement())
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

func (ds deploymentStatements) list(ctx context.Context, filter *database.ListOptions[domain.DeploymentField], liveAt *time.Time) (*database.ListResult[*domain.Deployment], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, deploymentSchema, func(limit uint32) ([]*domain.Deployment, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, deploymentQuery, filter, deploymentSchema, deploymentTable, "id"); err != nil {
			return nil, err
		}
		return ds.collect(ctx, compiler.statement())
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

func (ds deploymentStatements) collect(ctx context.Context, stmt spanner.Statement) ([]*domain.Deployment, error) {
	var items []*domain.Deployment
	if err := ds.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, err
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
		rows, err = ds.collectTargets(ctx, liveTargetsStmt, projectID, ids, *liveAt)
	} else {
		rows, err = ds.collectTargets(ctx, targetsQuery, projectID, ids)
	}
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, rows)
	return nil
}

func (ds deploymentStatements) collectTargets(ctx context.Context, query string, args ...any) ([]domain.TargetDeployment, error) {
	var items []domain.TargetDeployment
	if err := ds.db.Query(ctx, buildStatement(query, args...).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, func(row *spanner.Row) (domain.TargetDeployment, error) {
			var (
				scanned domain.TargetDeployment
				kind    string
			)
			if err := row.Columns(&scanned.Origin, &scanned.DeploymentID, &scanned.ReleaseID, &kind, &scanned.DeployedAt, &scanned.Seq); err != nil {
				return scanned, err
			}
			scanned.DeployedAt = scanned.DeployedAt.UTC()
			return deployment.WithKind(scanned, kind)
		})
		return err
	}); err != nil {
		return nil, err
	}
	return items, nil
}

func scanDeployment(row *spanner.Row) (*domain.Deployment, error) {
	var (
		scanned      deployment.Row
		metadataJSON spanner.NullJSON
		deployedAt   time.Time
	)
	if err := row.Columns(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.ReleaseID,
		&scanned.TargetKind,
		&metadataJSON,
		&deployedAt,
	); err != nil {
		return nil, err
	}
	rawMetadata, err := decodeNullJSON(metadataJSON)
	if err != nil {
		return nil, err
	}
	scanned.Metadata = rawMetadata
	scanned.DeployedAt = deployedAt
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
