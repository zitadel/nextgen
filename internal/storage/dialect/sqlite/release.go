package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/release"
)

const (
	createReleaseStmt = `INSERT INTO releases (project_id, id, content_hash, pointers, metadata, created_at)` +
		` VALUES (?, ?, ?, ?, ?, ?) RETURNING created_at`
	releaseQuery = `SELECT project_id, id, content_hash, pointers, metadata, created_at FROM releases`
)

type releaseStatements struct{ statement }

func newReleaseStatements(client queryExecutor) releaseStatements {
	return releaseStatements{statement: statement{client: client}}
}

// CreateRelease implements [service.ReleaseStatements].
func (rs releaseStatements) CreateRelease(ctx context.Context, entity *domain.Release) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixRelease); err != nil {
		return err
	}
	pointers, err := release.MarshalPointers(entity.Pointers)
	if err != nil {
		return err
	}
	metadata, err := release.MarshalMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	now := nowUnixNano()
	return withTransaction(ctx, rs.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano int64
		if err := tx.QueryRow(ctx, createReleaseStmt,
			entity.ProjectID,
			entity.ID,
			entity.ContentHash,
			string(pointers),
			string(metadata),
			now,
		).Scan(&createdNano); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = timeFromUnixNano(createdNano)
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindRelease, entity.ProjectID, entity.ID))
	})
}

// GetReleaseByID implements [service.ReleaseStatements].
func (rs releaseStatements) GetReleaseByID(ctx context.Context, projectID, id string) (*domain.Release, error) {
	return rs.getOne(ctx, database.And(
		database.Equal(database.Col(domain.ReleaseFieldProjectID), projectID),
		database.Equal(database.Col(domain.ReleaseFieldID), id),
	))
}

// GetReleaseByContentHash implements [service.ReleaseStatements].
func (rs releaseStatements) GetReleaseByContentHash(ctx context.Context, projectID, contentHash string) (*domain.Release, error) {
	return rs.getOne(ctx, database.And(
		database.Equal(database.Col(domain.ReleaseFieldProjectID), projectID),
		database.Equal(database.Col(domain.ReleaseFieldContentHash), contentHash),
	))
}

func (rs releaseStatements) getOne(ctx context.Context, filter database.Filter[domain.ReleaseField]) (*domain.Release, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, releaseQuery, &database.ListOptions[domain.ReleaseField]{
		Filter: filter,
	}, release.Schema); err != nil {
		return nil, err
	}
	rows, err := rs.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanRelease)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
}

// ListReleases implements [service.ReleaseStatements].
func (rs releaseStatements) ListReleases(ctx context.Context, filter *database.ListOptions[domain.ReleaseField]) (*database.ListResult[*domain.Release], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, releaseQuery, filter, release.Schema, "releases", "id"); err != nil {
		return nil, err
	}
	rows, err := rs.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, scanRelease)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		release.Schema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.Release]{Items: items, NextCursor: nextCursor}, nil
}

func scanRelease(rows *sql.Rows) (*domain.Release, error) {
	var (
		scanned     release.Row
		pointers    sql.NullString
		metadata    sql.NullString
		createdNano int64
	)
	if err := rows.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.ContentHash,
		&pointers,
		&metadata,
		&createdNano,
	); err != nil {
		return nil, err
	}
	if pointers.Valid && pointers.String != "" {
		scanned.Pointers = []byte(pointers.String)
	}
	if metadata.Valid && metadata.String != "" {
		scanned.Metadata = []byte(metadata.String)
	}
	scanned.CreatedAt = timeFromUnixNano(createdNano)
	return release.ToDomain(scanned)
}

var _ service.ReleaseStatements = (*releaseStatements)(nil)
