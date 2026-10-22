package compiler

// computeClosure expands immediate computed-userset implications into their
// reflexive transitive closure. The profile validator has already rejected
// cycles, but the visited-depth map also keeps this function finite if called
// with duplicate edges.
func computeClosure(
	definitions []RelationDefinition,
	direct map[Relation][]Relation,
) []Implication {
	order := make([]Relation, 0, len(definitions))
	for _, definition := range definitions {
		order = append(order, definition.Relation)
	}

	closure := make([]Implication, 0, len(order))
	for _, source := range order {
		depths := shortestDepths(source, direct)
		// Emit in catalog order, not map or traversal order, so catalog
		// mutations and diffs remain deterministic.
		for _, implied := range order {
			depth, ok := depths[implied]
			if !ok {
				continue
			}
			closure = append(closure, Implication{
				Source:  source,
				Implied: implied,
				Depth:   depth,
			})
		}
	}
	return closure
}

func shortestDepths(source Relation, direct map[Relation][]Relation) map[Relation]int {
	depths := map[Relation]int{source: 0}
	queue := []Relation{source}

	for i := 0; i < len(queue); i++ {
		current := queue[i]
		nextDepth := depths[current] + 1

		for _, implied := range direct[current] {
			if depth, seen := depths[implied]; seen && depth <= nextDepth {
				continue
			}
			depths[implied] = nextDepth
			queue = append(queue, implied)
		}
	}
	return depths
}
