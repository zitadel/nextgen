package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

const (
	authzCatalogsTable = "authz_catalogs"

	retireActiveCatalogStmt = `
UPDATE authz_catalogs
SET status = 'retired', active_guard = NULL
WHERE catalog_kind = @p1 AND owner_id = @p2 AND status = 'active'`

	insertAuthzCatalogStmt = `
INSERT INTO authz_catalogs (
    id, catalog_kind, owner_id, version, status, source_hash, active_guard
) VALUES (@p1, @p2, @p3, @p4, 'active', @p5, '1')`

	insertAuthzRelationStmt = `
INSERT INTO authz_relations (
    catalog_id, object_type, relation, kind
) VALUES (@p1, @p2, @p3, @p4)`

	insertAuthzRelationReferenceStmt = `
INSERT INTO authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)`

	insertAuthzExpressionEdgeStmt = `
INSERT INTO authz_expression_edges (
    catalog_id, object_type, relation, kind,
    source_object_type, source_relation,
    tupleset_object_type, tupleset_relation, position
) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9)`

	insertAuthzRelationClosureStmt = `
INSERT INTO authz_relation_closure (
    catalog_id, from_object_type, from_relation, to_object_type, to_relation, depth
) VALUES (@p1, @p2, @p3, @p4, @p5, @p6)`

	listAuthzRelationsByCatalogStmt = `
SELECT object_type, relation, kind
FROM authz_relations
WHERE catalog_id = @p1
ORDER BY object_type, relation`

	listAuthzRelationReferencesByCatalogStmt = `
SELECT object_type, relation, ref_type, ref_relation, wildcard, condition, position
FROM authz_relation_references
WHERE catalog_id = @p1
ORDER BY object_type, relation, position`

	listAuthzExpressionEdgesByCatalogStmt = `
SELECT object_type, relation, kind,
       source_object_type, source_relation,
       tupleset_object_type, tupleset_relation, position
FROM authz_expression_edges
WHERE catalog_id = @p1
ORDER BY object_type, relation, position`

	listAuthzRelationClosureByCatalogStmt = `
SELECT from_object_type, from_relation, to_object_type, to_relation, depth
FROM authz_relation_closure
WHERE catalog_id = @p1
ORDER BY from_object_type, from_relation, to_object_type, to_relation`
)

var authzCatalogColumns = []string{
	"id", "catalog_kind", "owner_id", "version", "status", "source_hash",
}

type authzCatalogStatements struct{ statement }

func newAuthzCatalogStatements(db queryExecutor) authzCatalogStatements {
	return authzCatalogStatements{
		statement: statement{
			db: db,
		},
	}
}

// PersistCatalogVersion implements [service.AuthzCatalogStatements].
func (s authzCatalogStatements) PersistCatalogVersion(
	ctx context.Context,
	meta domain.AuthzCatalogVersion,
	mutations compiler.CatalogMutations,
) error {
	authz.BeforePersistCatalogVersion(meta.CatalogKind)
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		return persistCatalogVersion(ctx, tx, meta, mutations)
	})
	if err != nil {
		return err
	}
	authz.AfterPersistCatalogVersion(meta.CatalogKind, meta.ID)
	return nil
}

func persistCatalogVersion(
	ctx context.Context,
	tx queryExecutor,
	meta domain.AuthzCatalogVersion,
	mutations compiler.CatalogMutations,
) error {
	rows, err := authz.BuildCatalogRows(meta.ID, mutations)
	if err != nil {
		return err
	}
	if _, err := tx.Update(ctx, buildStatement(retireActiveCatalogStmt, meta.CatalogKind.String(), meta.OwnerID).statement()); err != nil {
		return err
	}
	if _, err := tx.Update(ctx, buildStatement(insertAuthzCatalogStmt,
		meta.ID, meta.CatalogKind.String(), meta.OwnerID, meta.Version, spannerNullString(meta.SourceHash),
	).statement()); err != nil {
		return err
	}

	for _, rel := range rows.Relations {
		if _, err := tx.Update(ctx, buildStatement(insertAuthzRelationStmt,
			rel.CatalogID, rel.ObjectType, rel.Relation, rel.Kind,
		).statement()); err != nil {
			return err
		}
	}

	for _, ref := range rows.References {
		if _, err := tx.Update(ctx, buildStatement(insertAuthzRelationReferenceStmt,
			ref.CatalogID, ref.ObjectType, ref.Relation,
			ref.RefType, ref.RefRelation, ref.Wildcard, ref.Condition,
			ref.Position,
		).statement()); err != nil {
			return err
		}
	}

	for _, edge := range rows.Edges {
		if _, err := tx.Update(ctx, buildStatement(insertAuthzExpressionEdgeStmt,
			edge.CatalogID, edge.ObjectType, edge.Relation, edge.Kind,
			spannerNullString(edge.SourceObjectType), spannerNullString(edge.SourceRelation),
			spannerNullString(edge.TuplesetObjectType), spannerNullString(edge.TuplesetRelation),
			edge.Position,
		).statement()); err != nil {
			return err
		}
	}

	for _, impl := range rows.Closure {
		if _, err := tx.Update(ctx, buildStatement(insertAuthzRelationClosureStmt,
			impl.CatalogID,
			impl.FromObjectType, impl.FromRelation,
			impl.ToObjectType, impl.ToRelation,
			impl.Depth,
		).statement()); err != nil {
			return err
		}
	}
	return nil
}

// GetAuthzCatalog implements [service.AuthzCatalogStatements].
func (s authzCatalogStatements) GetAuthzCatalog(ctx context.Context, catalogID string) (*domain.AuthzCatalog, error) {
	row, err := s.db.ReadRow(ctx, authzCatalogsTable, spanner.Key{catalogID}, authzCatalogColumns)
	if err != nil {
		return nil, err
	}
	catalog, err := scanAuthzCatalogMeta(row)
	if err != nil {
		return nil, err
	}

	err = s.db.Query(ctx, buildStatement(listAuthzRelationsByCatalogStmt, catalogID).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		catalog.Relations, qErr = collectRows(iter, scanAuthzRelation)
		return qErr
	})
	if err != nil {
		return nil, err
	}

	err = s.db.Query(ctx, buildStatement(listAuthzRelationReferencesByCatalogStmt, catalogID).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		catalog.References, qErr = collectRows(iter, scanAuthzRelationReference)
		return qErr
	})
	if err != nil {
		return nil, err
	}

	err = s.db.Query(ctx, buildStatement(listAuthzExpressionEdgesByCatalogStmt, catalogID).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		catalog.Edges, qErr = collectRows(iter, scanAuthzExpressionEdge)
		return qErr
	})
	if err != nil {
		return nil, err
	}

	err = s.db.Query(ctx, buildStatement(listAuthzRelationClosureByCatalogStmt, catalogID).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		catalog.Closure, qErr = collectRows(iter, scanAuthzRelationClosure)
		return qErr
	})
	if err != nil {
		return nil, err
	}
	return catalog, nil
}

// LoadCatalogMutations implements [service.AuthzCatalogStatements].
func (s authzCatalogStatements) LoadCatalogMutations(ctx context.Context, catalogID string) (compiler.PersistedCatalog, error) {
	catalog, err := s.GetAuthzCatalog(ctx, catalogID)
	if err != nil {
		return compiler.PersistedCatalog{}, err
	}
	return authz.PersistedCatalogFromDomain(catalog)
}

func scanAuthzCatalogMeta(row *spanner.Row) (*domain.AuthzCatalog, error) {
	c := new(domain.AuthzCatalog)
	var version int64
	if err := row.Columns(
		&c.ID, &c.CatalogKind, &c.OwnerID, &version, &c.Status, &c.SourceHash,
	); err != nil {
		return nil, err
	}
	c.Version = int(version)
	return c, nil
}

func scanAuthzRelation(row *spanner.Row) (domain.AuthzRelation, error) {
	var r domain.AuthzRelation
	err := row.Columns(&r.ObjectType, &r.Relation, &r.Kind)
	return r, err
}

func scanAuthzRelationReference(row *spanner.Row) (domain.AuthzRelationReference, error) {
	var r domain.AuthzRelationReference
	var position int64
	err := row.Columns(
		&r.ObjectType, &r.Relation,
		&r.RefType, &r.RefRelation, &r.Wildcard, &r.Condition, &position,
	)
	r.Position = int(position)
	return r, err
}

func scanAuthzExpressionEdge(row *spanner.Row) (domain.AuthzExpressionEdge, error) {
	var e domain.AuthzExpressionEdge
	var position int64
	err := row.Columns(
		&e.ObjectType, &e.Relation, &e.Kind,
		&e.SourceObjectType, &e.SourceRelation,
		&e.TuplesetObjectType, &e.TuplesetRelation, &position,
	)
	e.Position = int(position)
	return e, err
}

func scanAuthzRelationClosure(row *spanner.Row) (domain.AuthzRelationClosure, error) {
	var c domain.AuthzRelationClosure
	var depth int64
	err := row.Columns(&c.FromObjectType, &c.FromRelation, &c.ToObjectType, &c.ToRelation, &depth)
	c.Depth = int(depth)
	return c, err
}

func spannerNullString(p *string) any {
	if p == nil {
		return spanner.NullString{Valid: false}
	}
	return *p
}

func spannerNullTime(t *time.Time) any {
	if t == nil {
		return spanner.NullTime{Valid: false}
	}
	return *t
}

var _ service.AuthzCatalogStatements = (*authzCatalogStatements)(nil)
