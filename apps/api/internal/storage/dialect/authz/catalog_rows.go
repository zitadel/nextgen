// Package authz holds dialect-independent Wave 1 authz persistence helpers:
// lifecycle projection (multi-write), membership-edge Filter schema, and catalog
// row mapping from compiler mutations.
package authz

import (
	"fmt"

	authzmodel "github.com/zitadel/nextgen/internal/authz"
	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
)

// EmptyToNil returns nil for empty strings (SQL NULL for optional columns).
func EmptyToNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ExpressionEdgeKind returns the authz_expression_edges.kind CHECK value for a compiler term.
func ExpressionEdgeKind(k compiler.TermKind) (string, error) {
	switch k {
	case compiler.TermDirect:
		return "direct", nil
	case compiler.TermComputedUserset:
		return "computed_userset", nil
	case compiler.TermTupleToUserset:
		return "tuple_to_userset", nil
	case compiler.TermInvalid:
		return "", fmt.Errorf("invalid expression edge kind")
	default:
		return "", fmt.Errorf("unknown expression edge kind %d", k)
	}
}

// ParseExpressionEdgeKind maps an authz_expression_edges.kind column value to TermKind.
func ParseExpressionEdgeKind(kind string) (compiler.TermKind, error) {
	switch kind {
	case "direct":
		return compiler.TermDirect, nil
	case "computed_userset":
		return compiler.TermComputedUserset, nil
	case "tuple_to_userset":
		return compiler.TermTupleToUserset, nil
	default:
		return compiler.TermInvalid, fmt.Errorf("unknown expression edge kind %q", kind)
	}
}

// PersistedCatalogFromDomain maps a loaded domain catalog projection into the
// compiler-shaped rows used by persist round-trip tests.
func PersistedCatalogFromDomain(catalog *domain.AuthzCatalog) (compiler.PersistedCatalog, error) {
	if catalog == nil {
		return compiler.PersistedCatalog{}, fmt.Errorf("nil authz catalog")
	}
	out := compiler.PersistedCatalog{
		Relations:          make([]compiler.RelationDefinition, 0, len(catalog.Relations)),
		RelationReferences: make([]compiler.RelationReference, 0, len(catalog.References)),
		ExpressionEdges:    make([]compiler.ExpressionEdge, 0, len(catalog.Edges)),
		Closure:            make([]compiler.Implication, 0, len(catalog.Closure)),
	}
	for _, rel := range catalog.Relations {
		out.Relations = append(out.Relations, compiler.RelationDefinition{
			Relation: compiler.Relation{Type: rel.ObjectType, Name: rel.Relation},
		})
	}
	for _, ref := range catalog.References {
		out.RelationReferences = append(out.RelationReferences, compiler.RelationReference{
			Relation: compiler.Relation{Type: ref.ObjectType, Name: ref.Relation},
			Reference: authzmodel.RelationReference{
				Type:      ref.RefType,
				Relation:  ref.RefRelation,
				Wildcard:  ref.Wildcard,
				Condition: ref.Condition,
			},
			Position: ref.Position,
		})
	}
	for _, edge := range catalog.Edges {
		kind, err := ParseExpressionEdgeKind(edge.Kind)
		if err != nil {
			return compiler.PersistedCatalog{}, err
		}
		out.ExpressionEdges = append(out.ExpressionEdges, compiler.ExpressionEdge{
			Target:   compiler.Relation{Type: edge.ObjectType, Name: edge.Relation},
			Kind:     kind,
			Source:   compiler.Relation{Type: derefString(edge.SourceObjectType), Name: derefString(edge.SourceRelation)},
			Tupleset: compiler.Relation{Type: derefString(edge.TuplesetObjectType), Name: derefString(edge.TuplesetRelation)},
			Position: edge.Position,
		})
	}
	for _, impl := range catalog.Closure {
		out.Closure = append(out.Closure, compiler.Implication{
			Source:  compiler.Relation{Type: impl.FromObjectType, Name: impl.FromRelation},
			Implied: compiler.Relation{Type: impl.ToObjectType, Name: impl.ToRelation},
			Depth:   impl.Depth,
		})
	}
	return out, nil
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// RelationRow is one authz_relations insert.
type RelationRow struct {
	CatalogID  string
	ObjectType string
	Relation   string
	Kind       string
}

// RelationReferenceRow is one authz_relation_references insert.
type RelationReferenceRow struct {
	CatalogID   string
	ObjectType  string
	Relation    string
	RefType     string
	RefRelation string
	Wildcard    bool
	Condition   string
	Position    int
}

// ExpressionEdgeRow is one authz_expression_edges insert.
type ExpressionEdgeRow struct {
	CatalogID          string
	ObjectType         string
	Relation           string
	Kind               string
	SourceObjectType   *string
	SourceRelation     *string
	TuplesetObjectType *string
	TuplesetRelation   *string
	Position           int
}

// ClosureRow is one authz_relation_closure insert.
type ClosureRow struct {
	CatalogID      string
	FromObjectType string
	FromRelation   string
	ToObjectType   string
	ToRelation     string
	Depth          int
}

// CatalogRows are storage-ready rows derived from compiler.CatalogMutations.
type CatalogRows struct {
	Relations  []RelationRow
	References []RelationReferenceRow
	Edges      []ExpressionEdgeRow
	Closure    []ClosureRow
}

// BuildCatalogRows maps compiler mutations into typed insert rows.
func BuildCatalogRows(catalogID string, mutations compiler.CatalogMutations) (CatalogRows, error) {
	rows := CatalogRows{
		Relations:  make([]RelationRow, 0, len(mutations.Relations)),
		References: make([]RelationReferenceRow, 0, len(mutations.RelationReferences)),
		Edges:      make([]ExpressionEdgeRow, 0, len(mutations.ExpressionEdges)),
		Closure:    make([]ClosureRow, 0, len(mutations.Closure)),
	}
	for _, rel := range mutations.Relations {
		// MVP: compiler has no relation kind, so every row is 'relation'.
		// CHECK also allows 'permission', but nothing produces it yet.
		rows.Relations = append(rows.Relations, RelationRow{
			CatalogID:  catalogID,
			ObjectType: rel.Relation.Type,
			Relation:   rel.Relation.Name,
			Kind:       domain.AuthzRelationKindRelation.String(),
		})
	}
	for _, ref := range mutations.RelationReferences {
		rows.References = append(rows.References, RelationReferenceRow{
			CatalogID:   catalogID,
			ObjectType:  ref.Relation.Type,
			Relation:    ref.Relation.Name,
			RefType:     ref.Reference.Type,
			RefRelation: ref.Reference.Relation,
			Wildcard:    ref.Reference.Wildcard,
			Condition:   ref.Reference.Condition,
			Position:    ref.Position,
		})
	}
	for _, edge := range mutations.ExpressionEdges {
		kind, err := ExpressionEdgeKind(edge.Kind)
		if err != nil {
			return CatalogRows{}, err
		}
		rows.Edges = append(rows.Edges, ExpressionEdgeRow{
			CatalogID:          catalogID,
			ObjectType:         edge.Target.Type,
			Relation:           edge.Target.Name,
			Kind:               kind,
			SourceObjectType:   EmptyToNil(edge.Source.Type),
			SourceRelation:     EmptyToNil(edge.Source.Name),
			TuplesetObjectType: EmptyToNil(edge.Tupleset.Type),
			TuplesetRelation:   EmptyToNil(edge.Tupleset.Name),
			Position:           edge.Position,
		})
	}
	for _, impl := range mutations.Closure {
		rows.Closure = append(rows.Closure, ClosureRow{
			CatalogID:      catalogID,
			FromObjectType: impl.Source.Type,
			FromRelation:   impl.Source.Name,
			ToObjectType:   impl.Implied.Type,
			ToRelation:     impl.Implied.Name,
			Depth:          impl.Depth,
		})
	}
	return rows, nil
}
