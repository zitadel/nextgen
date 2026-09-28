package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/release"
)

const (
	releaseTable      = "releases"
	createReleaseStmt = `INSERT INTO releases (project_id, id, content_hash, pointers, metadata)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5) THEN RETURN created_at`
	releaseQuery = `SELECT project_id, id, content_hash, pointers, metadata, created_at FROM releases`
)

var releaseColumns = []string{
	"project_id", "id", "content_hash", "pointers", "metadata", "created_at",
}

type releaseStatements struct{ statement }

func newReleaseStatements(db queryExecutor) releaseStatements {
	return releaseStatements{statement: statement{db: db}}
}

// CreateRelease implements [service.ReleaseStatements].
func (rs releaseStatements) CreateRelease(ctx context.Context, entity *domain.Release) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixRelease); err != nil {
		return err
	}
	rawPointers, err := release.MarshalPointers(entity.Pointers)
	if err != nil {
		return err
	}
	pointers, err := encodeNullJSON(rawPointers)
	if err != nil {
		return err
	}
	rawMetadata, err := release.MarshalMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	metadata, err := encodeNullJSON(rawMetadata)
	if err != nil {
		return err
	}

	return withTransaction(ctx, rs.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createReleaseStmt,
			entity.ProjectID,
			entity.ID,
			entity.ContentHash,
			pointers,
			metadata,
		).statement()
		if err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				if err := row.Columns(&entity.CreatedAt); err != nil {
					return struct{}{}, err
				}
				entity.CreatedAt = entity.CreatedAt.UTC()
				return struct{}{}, nil
			})
			return err
		}); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindRelease, entity.ProjectID, entity.ID))
	})
}

// GetReleaseByID implements [service.ReleaseStatements].
func (rs releaseStatements) GetReleaseByID(ctx context.Context, projectID, id string) (*domain.Release, error) {
	row, err := rs.db.ReadRow(ctx, releaseTable, spanner.Key{projectID, id}, releaseColumns)
	if err != nil {
		return nil, err
	}
	return rs.scanRelease(row)
}

// GetReleaseByContentHash implements [service.ReleaseStatements].
//
// The content hash is a unique index rather than a primary-key prefix, so this
// goes through the compiler instead of ReadRow.
func (rs releaseStatements) GetReleaseByContentHash(ctx context.Context, projectID, contentHash string) (*domain.Release, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, releaseQuery, &database.ListOptions[domain.ReleaseField]{
		Filter: database.And(
			database.Equal(database.Col(domain.ReleaseFieldProjectID), projectID),
			database.Equal(database.Col(domain.ReleaseFieldContentHash), contentHash),
		),
	}, release.Schema); err != nil {
		return nil, err
	}

	var entity *domain.Release
	if err := rs.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, rs.scanRelease)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

// ListReleases implements [service.ReleaseStatements].
func (rs releaseStatements) ListReleases(ctx context.Context, filter *database.ListOptions[domain.ReleaseField]) (*database.ListResult[*domain.Release], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, releaseQuery, filter, release.Schema, "releases", "id"); err != nil {
		return nil, err
	}

	var items []*domain.Release
	if err := rs.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, rs.scanRelease)
		return err
	}); err != nil {
		return nil, err
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		release.Schema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.Release]{Items: items, NextCursor: nextCursor}, nil
}

func (rs releaseStatements) scanRelease(row *spanner.Row) (*domain.Release, error) {
	var (
		scanned      release.Row
		pointersJSON spanner.NullJSON
		metadataJSON spanner.NullJSON
		createdAt    time.Time
	)
	if err := row.Columns(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.ContentHash,
		&pointersJSON,
		&metadataJSON,
		&createdAt,
	); err != nil {
		return nil, err
	}

	rawPointers, err := decodeNullJSON(pointersJSON)
	if err != nil {
		return nil, err
	}
	rawMetadata, err := decodeNullJSON(metadataJSON)
	if err != nil {
		return nil, err
	}
	scanned.Pointers = rawPointers
	scanned.Metadata = rawMetadata
	scanned.CreatedAt = createdAt
	return release.ToDomain(scanned)
}

var _ service.ReleaseStatements = (*releaseStatements)(nil)
