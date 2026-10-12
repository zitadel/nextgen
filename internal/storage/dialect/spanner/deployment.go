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
	targetsQuery    = `SELECT deployment_id, origin, release_id, deployed_at FROM deployment_targets` +
		` WHERE project_id = @p1 AND deployment_id IN UNNEST(@p2)`
	existingPreviewsQuery = `SELECT origin FROM previews WHERE project_id = @p1 AND origin IN UNNEST(@p2)`
	// See the postgres statements.
	newestDeploymentStmt = deploymentQuery + ` WHERE project_id = @p1 AND id = (` +
		`SELECT t.deployment_id FROM deployment_targets t` +
		` WHERE t.project_id = @p1 AND t.origin = @p2` +
		` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1)`
	deploymentAtStmt = deploymentQuery + ` WHERE project_id = @p1 AND id = (` +
		`SELECT t.deployment_id FROM deployment_targets t` +
		` WHERE t.project_id = @p1 AND t.origin = @p2 AND t.deployed_at <= @p3` +
		` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1)`
)

var (
	deploymentSchema = deployment.NewSchema(deploymentTable, targetsTable, previewTable)

	deploymentColumns = []string{"project_id", "id", "release_id", "target_kind", "metadata", "deployed_at"}

	// See the postgres statements.
	newestTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM deployment_targets t` +
		` WHERE t.project_id = @p1 AND t.origin IN UNNEST(@p2) AND NOT ` + deployment.NewerTargetExists(targetsTable)
	liveTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = @p1 AND t.deployment_id IN UNNEST(@p2) AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt(previewTable) + `@p3))`
	servingTargetsStmt = `SELECT t.deployment_id, t.origin, t.release_id, t.deployed_at FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = @p1 AND t.release_id = @p2 AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt(previewTable) + `@p3))` +
		` ORDER BY t.origin`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(db queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{db: db}}
}

// lockProject reads the project row inside the read-write transaction. A
// missing project is a NoRowFoundError. The transaction is serializable, so
// two deploys that read the same targets and both write cannot both commit:
// one aborts and its retry reads the other's rows.
func lockProject(ctx context.Context, tx queryExecutor, projectID string) error {
	_, err := tx.ReadRow(ctx, "projects", spanner.Key{projectID}, []string{"id"})
	return err
}

// CreateDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment, expectedDeploymentID *string, previewTTL time.Duration) (created bool, err error) {
	if entity.TargetKind == domain.DeploymentTargetKindPreview && previewTTL <= 0 {
		return false, domain.ErrDeploymentInvalid("a deployment to preview URLs needs a ttl", nil)
	}
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return false, err
	}
	rawMetadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return false, err
	}
	metadata, err := encodeNullJSON(rawMetadata)
	if err != nil {
		return false, err
	}
	origins := entity.Origins()
	// The answer and the stamp are staged here and copied onto the entity
	// only after the transaction commits: ReadWriteTransaction retries
	// aborted attempts without undoing the callback's side effects.
	var (
		existing   *domain.Deployment
		deployedAt time.Time
	)
	err = withTransaction(ctx, ds.db, func(ctx context.Context, tx queryExecutor) error {
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
			if current, err = ds.get(ctx, tx, entity.ProjectID, top.DeploymentID); err != nil {
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

		deployedAt = deployment.Stamp(time.Now(), deployment.StampFloor(top))
		mutations := []*spanner.Mutation{
			spanner.Insert(deploymentTable, deploymentColumns, []any{
				entity.ProjectID, entity.ID, entity.ReleaseID, entity.TargetKind.String(), metadata, deployedAt,
			}),
		}
		for _, origin := range origins {
			mutations = append(mutations, spanner.Insert(targetsTable,
				[]string{"project_id", "deployment_id", "origin", "release_id", "deployed_at"},
				[]any{entity.ProjectID, entity.ID, origin, entity.ReleaseID, deployedAt}))
		}
		if entity.TargetKind == domain.DeploymentTargetKindPreview {
			renewals, err := ds.previewMutations(ctx, tx, entity.ProjectID, origins,
				deployedAt.Add(previewTTL).Truncate(time.Microsecond), deployedAt)
			if err != nil {
				return err
			}
			mutations = append(mutations, renewals...)
		}
		if err := tx.BufferWrite(ctx, mutations); err != nil {
			return err
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

// previewMutations creates the previews of origins that have none and renews
// the rest, keeping their created_at: the first deploy to the URL.
func (ds deploymentStatements) previewMutations(ctx context.Context, tx queryExecutor, projectID string, origins []string, expiresAt, createdAt time.Time) ([]*spanner.Mutation, error) {
	present := make(map[string]bool, len(origins))
	if err := tx.Query(ctx, buildStatement(existingPreviewsQuery, projectID, origins).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectRows(iter, func(row *spanner.Row) (struct{}, error) {
			var origin string
			if err := row.Columns(&origin); err != nil {
				return struct{}{}, err
			}
			present[origin] = true
			return struct{}{}, nil
		})
		return err
	}); err != nil {
		return nil, err
	}
	mutations := make([]*spanner.Mutation, 0, len(origins))
	for _, origin := range origins {
		if present[origin] {
			mutations = append(mutations, spanner.Update(previewTable,
				[]string{"project_id", "origin", "expires_at"},
				[]any{projectID, origin, expiresAt}))
			continue
		}
		mutations = append(mutations, spanner.Insert(previewTable,
			[]string{"project_id", "origin", "expires_at", "created_at"},
			[]any{projectID, origin, expiresAt, createdAt}))
	}
	return mutations, nil
}

// get reads one deployment with every target it named.
func (ds deploymentStatements) get(ctx context.Context, db queryExecutor, projectID, id string) (*domain.Deployment, error) {
	row, err := db.ReadRow(ctx, deploymentTable, spanner.Key{projectID, id}, deploymentColumns)
	if err != nil {
		return nil, err
	}
	entity, err := scanDeployment(row)
	if err != nil {
		return nil, err
	}
	if err := ds.attachTargets(ctx, db, projectID, []*domain.Deployment{entity}, nil); err != nil {
		return nil, err
	}
	return entity, nil
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	return ds.get(ctx, ds.db, projectID, id)
}

// NewestDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	return ds.getOne(ctx, buildStatement(newestDeploymentStmt, projectID, origin).statement())
}

// DeploymentAt implements [service.DeploymentStatements].
func (ds deploymentStatements) DeploymentAt(ctx context.Context, projectID, origin string, at time.Time) (*domain.Deployment, error) {
	return ds.getOne(ctx, buildStatement(deploymentAtStmt, projectID, origin, at).statement())
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
	if err := ds.attachTargets(ctx, ds.db, entity.ProjectID, []*domain.Deployment{entity}, nil); err != nil {
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
	if err := ds.attachTargets(ctx, ds.db, projectID, items, nil); err != nil {
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
		if err := compileList(ctx, &compiler, deploymentQuery, filter, deploymentSchema, deploymentTable, "id"); err != nil {
			return nil, err
		}
		return ds.collect(ctx, compiler.statement())
	})
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		if err := ds.attachTargets(ctx, ds.db, items[0].ProjectID, items, liveAt); err != nil {
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

// attachTargets reads the target rows of items in one round trip: every row,
// or with liveAt only the rows still serving then.
func (ds deploymentStatements) attachTargets(ctx context.Context, db queryExecutor, projectID string, items []*domain.Deployment, liveAt *time.Time) error {
	ids := deployment.DeploymentIDs(items)
	var (
		rows []deployment.TargetRow
		err  error
	)
	if liveAt != nil {
		rows, err = ds.collectTargets(ctx, db, liveTargetsStmt, projectID, ids, *liveAt)
	} else {
		rows, err = ds.collectTargets(ctx, db, targetsQuery, projectID, ids)
	}
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, rows)
	return nil
}

func (ds deploymentStatements) collectTargets(ctx context.Context, db queryExecutor, query string, args ...any) ([]deployment.TargetRow, error) {
	var items []deployment.TargetRow
	if err := db.Query(ctx, buildStatement(query, args...).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, func(row *spanner.Row) (deployment.TargetRow, error) {
			var scanned deployment.TargetRow
			if err := row.Columns(&scanned.DeploymentID, &scanned.Origin, &scanned.ReleaseID, &scanned.DeployedAt); err != nil {
				return scanned, err
			}
			scanned.DeployedAt = scanned.DeployedAt.UTC()
			return scanned, nil
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
