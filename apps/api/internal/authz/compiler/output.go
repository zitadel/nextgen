package compiler

import (
	"github.com/zitadel/nextgen/internal/authz"
)

// Relation identifies one relation on one object type.
type Relation struct {
	Type string
	Name string
}

// Output is the complete result of compiling one catalog schema.
type Output struct {
	Catalog CatalogMutations
	Plans   []QueryPlan
}

// CatalogMutations are the storage-neutral rows needed to replace one catalog
// version. Callers add catalog/version and partition metadata when persisting
// them.
type CatalogMutations struct {
	SchemaVersion      string
	Types              []TypeDefinition
	Relations          []RelationDefinition
	RelationReferences []RelationReference
	ExpressionEdges    []ExpressionEdge
	Closure            []Implication
}

type TypeDefinition struct {
	Name string
}

type RelationDefinition struct {
	Relation Relation
}

// RelationReference is one direct-assignment type restriction belonging to a
// relation. Position preserves the normalized, deterministic order.
type RelationReference struct {
	Relation  Relation
	Reference authz.RelationReference
	Position  int
}

// TermKind identifies one supported leaf in a relation expression.
type TermKind uint8

const (
	TermInvalid TermKind = iota
	TermDirect
	TermComputedUserset
	TermTupleToUserset
)

// PersistedCatalog is the subset of [CatalogMutations] that PersistCatalogVersion
// writes and LoadCatalogMutations reads (relations, references, edges, closure).
// SchemaVersion and Types are compile-time metadata only.
type PersistedCatalog struct {
	Relations          []RelationDefinition
	RelationReferences []RelationReference
	ExpressionEdges    []ExpressionEdge
	Closure            []Implication
}

// Persisted returns the storage rows carried by m.
func (m CatalogMutations) Persisted() PersistedCatalog {
	return PersistedCatalog{
		Relations:          m.Relations,
		RelationReferences: m.RelationReferences,
		ExpressionEdges:    m.ExpressionEdges,
		Closure:            m.Closure,
	}
}

// ExpressionEdge is a flattened OR term suitable for relational storage.
// The MVP profile only permits union as a set operator, so nested unions are
// associative and can be flattened without changing semantics.
//
// Field use depends on Kind:
//   - TermDirect: Source and Tupleset are zero values; direct type restrictions
//     live in CatalogMutations.RelationReferences.
//   - TermComputedUserset: Source is the relation implied on the same object.
//   - TermTupleToUserset: Source is the computed relation on the tupleset's
//     target type; Tupleset is the relation traversed on the target object.
type ExpressionEdge struct {
	Target   Relation
	Kind     TermKind
	Source   Relation
	Tupleset Relation
	Position int
}

// Implication is one row of the precomputed same-object relation closure:
// assigning Source also grants Implied. Depth is the shortest number of
// computed-userset edges between them; every relation has a reflexive depth-0
// row so a resolver can use one closure join for direct and implied grants.
//
// Object-bound userset references and tuple-to-userset traversals are not
// global implications and therefore never appear here.
type Implication struct {
	Source  Relation
	Implied Relation
	Depth   int
}

// QueryPlan groups the flattened expression terms for one target relation.
// The resolver can OR the terms as indexed semi-joins without re-walking the
// original OpenFGA expression tree.
type QueryPlan struct {
	Target Relation
	Terms  []QueryTerm
}

// QueryTerm is the runtime form of an ExpressionEdge. DirectReferences is set
// only for TermDirect; it tells the resolver which principal or userset shapes
// may be assigned directly.
type QueryTerm struct {
	Kind             TermKind
	Source           Relation
	Tupleset         Relation
	DirectReferences []authz.RelationReference
}
