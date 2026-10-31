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
	originsTable    = "deployment_origins"
	previewTable    = "previews"

	// CURRENT_TIMESTAMP() is taken when the deployment insert runs. Origin
	// rows copy that stamp: Spanner evaluates CURRENT_TIMESTAMP() per
	// statement, so a default on those rows would land later.
	createDeploymentStmt = `INSERT INTO deployments` +
		` (project_id, id, release_id, origin_kind, metadata, deployed_at)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, CURRENT_TIMESTAMP()) THEN RETURN deployed_at`
	deploymentQuery = `SELECT project_id, id, release_id, origin_kind, metadata, deployed_at FROM deployments`
)

var (
	deploymentTables = deployment.Tables{Deployments: deploymentTable, Origins: originsTable, Previews: previewTable, ProjectOrigins: "project_origins"}
	deploymentSchema = deployment.NewSchema(deploymentTables)

	deploymentColumns = []string{"project_id", "id", "release_id", "origin_kind", "metadata", "deployed_at"}
	originColumns     = []string{"project_id", "deployment_id", "origin", "release_id", "origin_kind", "deployed_at", "seq"}

	originsQuery        = deployment.OriginsSelect(originsTable) + ` WHERE t.project_id = @p1 AND t.deployment_id IN UNNEST(@p2)`
	newestPerOriginStmt = deployment.OriginsSelect(originsTable) +
		` WHERE t.project_id = @p1 AND t.origin IN UNNEST(@p2) AND NOT ` + deployment.NewerOriginRowExists(originsTable)
	liveOriginsStmt    = originsQuery + ` AND ` + deployment.RowServes(deploymentTables, "@p3")
	liveDeploymentStmt = deploymentQuery + ` WHERE project_id = @p1 AND id = (SELECT t.deployment_id FROM ` + originsTable + ` t` +
		` WHERE t.project_id = @p1 AND t.origin = @p2 AND ` + deployment.RowServes(deploymentTables, "@p3") + `)`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(db queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{db: db}}
}

// GetNewestPerOrigin implements [service.DeploymentStatements].
func (ds deploymentStatements) GetNewestPerOrigin(ctx context.Context, projectID string, origins []string) ([]domain.OriginDeployment, error) {
	return ds.collectOrigins(ctx, newestPerOriginStmt, projectID, origins)
}

// CreateDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment, read []domain.OriginDeployment) error {
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
		// A retry replays this callback, so the stamp stays local until the
		// writes have landed. The deployment row is DML: the variable-set
		// link that follows is SQL in this same transaction, and Spanner SQL
		// cannot see a buffered mutation.
		var stamped time.Time
		stmt := buildStatement(createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, entity.OriginKind.String(), metadata,
		).statement()
		if err := tx.Write(ctx, stmt, scanReturnedTimestamp(&stamped)); err != nil {
			return err
		}
		// Origin rows are not read here and are not the link's foreign key,
		// so one mutation applies them at commit.
		origins := entity.Origins()
		seqs := deployment.NextSeqs(origins, read)
		mutations := make([]*spanner.Mutation, 0, len(origins))
		for i, origin := range origins {
			mutations = append(mutations, spanner.Insert(originsTable, originColumns, []any{
				entity.ProjectID, entity.ID, origin, entity.ReleaseID, entity.OriginKind.String(), stamped, seqs[i],
			}))
		}
		if err := tx.BufferWrite(ctx, mutations); err != nil {
			return err
		}
		deployedAt = stamped
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

// LockPrimaryDeploys implements [service.DeploymentStatements]: a read-write
// transaction is serializable, so a racing deploy aborts and retries.
func (ds deploymentStatements) LockPrimaryDeploys(context.Context, string) error {
	return nil
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
	return ds.list(ctx, deployment.LiveAt(filter, now), &now)
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
	query, args := originsQuery, []any{projectID, deployment.DeploymentIDs(items)}
	if liveAt != nil {
		query, args = liveOriginsStmt, append(args, *liveAt)
	}
	rows, err := ds.collectOrigins(ctx, query, args...)
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, rows)
	return nil
}

func (ds deploymentStatements) collectOrigins(ctx context.Context, query string, args ...any) ([]domain.OriginDeployment, error) {
	var items []domain.OriginDeployment
	if err := ds.db.Query(ctx, buildStatement(query, args...).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, func(row *spanner.Row) (domain.OriginDeployment, error) {
			var (
				scanned domain.OriginDeployment
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
		&scanned.OriginKind,
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
