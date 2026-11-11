package profile

import (
	"github.com/zitadel/nextgen/internal/authz"
)

// node addresses one relation on one object type.
type node struct {
	objectType string
	relation   string
}

// modelIndex provides relation lookup and reference edges over a model. It
// preserves the model's sorted order so diagnostics are deterministic.
type modelIndex struct {
	order     []node
	relations map[node]authz.Relation
	types     map[string]struct{}
}

func newIndex(model authz.Model) modelIndex {
	index := modelIndex{
		order:     make([]node, 0),
		relations: make(map[node]authz.Relation),
		types:     make(map[string]struct{}, len(model.Types)),
	}

	for _, objectType := range model.Types {
		index.types[objectType.Name] = struct{}{}
		for _, relation := range objectType.Relations {
			key := node{objectType: objectType.Name, relation: relation.Name}
			index.order = append(index.order, key)
			index.relations[key] = relation
		}
	}

	return index
}

func (i modelIndex) hasType(name string) bool {
	_, ok := i.types[name]
	return ok
}

func (i modelIndex) relation(objectType, relation string) (authz.Relation, bool) {
	found, ok := i.relations[node{objectType: objectType, relation: relation}]
	return found, ok
}

func (i modelIndex) hasRelation(objectType, relation string) bool {
	_, ok := i.relation(objectType, relation)
	return ok
}

// recursionDiagnostics reports every relation that can resolve back to itself.
// Such a relation has no bounded expansion, so its closure cannot be
// precomputed at upload time.
//
// Each participant in a cycle is reported separately rather than reporting the
// cycle once: every one of them is independently unbounded, and naming each
// gives the author the coordinates to fix. Iteration follows the model's sorted
// order, so the diagnostic sequence is stable.
func (i modelIndex) recursionDiagnostics() Diagnostics {
	diagnostics := make(Diagnostics, 0)
	for _, start := range i.order {
		if !i.reachesSelf(start) {
			continue
		}
		diagnostics = append(diagnostics, Diagnostic{
			Code:     CodeUnboundedRecursion,
			Type:     start.objectType,
			Relation: start.relation,
			Message:  "relation resolves to itself, which cannot be expanded within a bounded closure",
		})
	}
	return diagnostics
}

// reachesSelf walks the reference graph outward from start, breadth first.
// The walk begins at start's references rather than at start itself, so a node
// only matches once it has been re-reached through an actual edge.
func (i modelIndex) reachesSelf(start node) bool {
	visited := make(map[node]struct{})
	queue := i.references(start)

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		if current == start {
			return true
		}
		if _, seen := visited[current]; seen {
			continue
		}
		visited[current] = struct{}{}
		queue = append(queue, i.references(current)...)
	}

	return false
}

// references returns the relations a relation depends on: userset restrictions
// on direct assignments, computed usersets, and the far side of a
// tuple-to-userset.
func (i modelIndex) references(from node) []node {
	relation, ok := i.relations[from]
	if !ok {
		return nil
	}

	references := make([]node, 0)
	for _, restriction := range relation.DirectlyRelatedTypes {
		if restriction.Relation == "" {
			continue
		}
		references = append(references, node{objectType: restriction.Type, relation: restriction.Relation})
	}

	return append(references, i.rewriteReferences(from.objectType, relation.Rewrite)...)
}

// rewriteReferences returns the nodes one rewrite depends on. Intersection and
// difference are traversed even though the profile rejects them, so a model
// that uses both an unsupported operator and recursion reports both rather than
// hiding the second behind the first.
func (i modelIndex) rewriteReferences(objectType string, rewrite authz.Rewrite) []node {
	switch rewrite.Kind {
	case authz.RewriteComputedUserset:
		return []node{{objectType: objectType, relation: rewrite.Relation}}
	case authz.RewriteTupleToUserset:
		// "<relation> from <tupleset>" resolves on the tupleset's target types,
		// so the edge lands on each target type's copy of the computed relation.
		tupleset, ok := i.relation(objectType, rewrite.Tupleset)
		if !ok {
			return nil
		}
		references := make([]node, 0, len(tupleset.DirectlyRelatedTypes))
		for _, restriction := range tupleset.DirectlyRelatedTypes {
			references = append(references, node{objectType: restriction.Type, relation: rewrite.Relation})
		}
		return references
	case authz.RewriteUnion, authz.RewriteIntersection, authz.RewriteDifference:
		references := make([]node, 0, len(rewrite.Children))
		for _, child := range rewrite.Children {
			references = append(references, i.rewriteReferences(objectType, child)...)
		}
		return references
	default:
		return nil
	}
}
