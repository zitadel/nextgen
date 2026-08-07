package compiler_test

import (
	"errors"
	"fmt"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz"
	"github.com/zitadel/nextgen/internal/authz/authztest"
	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/authz/profile"
)

// checkCompileInvariants asserts L2 compiler/profile properties for one model.
func checkCompileInvariants(t testing.TB, model authz.Model) {
	t.Helper()

	first, err := compiler.Compile(model)
	if err != nil {
		require.Empty(t, first, "profile failure must not emit partial output")
		var diagnostics profile.Diagnostics
		require.ErrorAs(t, err, &diagnostics, "compile errors must unwrap to profile.Diagnostics")
		require.NotEmpty(t, diagnostics)
		return
	}

	second, err := compiler.Compile(model)
	require.NoError(t, err)
	require.Equal(t, first, second, "compile must be deterministic")

	require.Equal(t, model.SchemaVersion, first.Catalog.SchemaVersion)
	require.Len(t, first.Catalog.Types, len(model.Types))
	require.Len(t, first.Plans, len(first.Catalog.Relations))

	relations := make(map[compiler.Relation]struct{}, len(first.Catalog.Relations))
	for _, definition := range first.Catalog.Relations {
		relations[definition.Relation] = struct{}{}
	}

	assertReflexiveClosure(t, first.Catalog)
	assertSameObjectClosure(t, first.Catalog)
	assertComputedImplications(t, first.Catalog)
	assertShortestClosureDepths(t, first.Catalog)
	assertDenseEdgePositions(t, first.Catalog)
	assertPlansMatchEdges(t, first)
	assertDenseReferencePositions(t, first.Catalog)
	assertNoDanglingEdgeTargets(t, first.Catalog, relations)
}

func assertReflexiveClosure(t testing.TB, catalog compiler.CatalogMutations) {
	t.Helper()
	for _, definition := range catalog.Relations {
		require.Contains(t, catalog.Closure, compiler.Implication{
			Source:  definition.Relation,
			Implied: definition.Relation,
			Depth:   0,
		}, "missing reflexive closure for %v", definition.Relation)
	}
}

func assertSameObjectClosure(t testing.TB, catalog compiler.CatalogMutations) {
	t.Helper()
	for _, implication := range catalog.Closure {
		require.Equal(t, implication.Source.Type, implication.Implied.Type,
			"closure must stay same-object: %#v", implication)
		require.GreaterOrEqual(t, implication.Depth, 0)
	}
}

func assertComputedImplications(t testing.TB, catalog compiler.CatalogMutations) {
	t.Helper()
	for _, edge := range catalog.ExpressionEdges {
		if edge.Kind != compiler.TermComputedUserset {
			continue
		}
		found := false
		for _, implication := range catalog.Closure {
			if implication.Source == edge.Source && implication.Implied == edge.Target && implication.Depth >= 1 {
				found = true
				break
			}
		}
		require.True(t, found,
			"computed userset edge %v -> %v missing from closure", edge.Source, edge.Target)
	}
}

func assertShortestClosureDepths(t testing.TB, catalog compiler.CatalogMutations) {
	t.Helper()
	direct := make(map[compiler.Relation][]compiler.Relation)
	for _, edge := range catalog.ExpressionEdges {
		if edge.Kind != compiler.TermComputedUserset {
			continue
		}
		direct[edge.Source] = append(direct[edge.Source], edge.Target)
	}

	got := make(map[compiler.Implication]struct{}, len(catalog.Closure))
	for _, implication := range catalog.Closure {
		got[implication] = struct{}{}
		want := shortestDepth(implication.Source, implication.Implied, direct)
		require.True(t, want.ok, "closure contains unreachable implication %#v", implication)
		require.Equal(t, want.depth, implication.Depth,
			"closure depth for %#v", implication)
	}

	for _, definition := range catalog.Relations {
		source := definition.Relation
		for implied, depth := range allShortestDepths(source, direct) {
			want := compiler.Implication{Source: source, Implied: implied, Depth: depth}
			_, ok := got[want]
			require.True(t, ok, "missing closure implication %#v", want)
		}
	}
}

type depthResult struct {
	depth int
	ok    bool
}

func shortestDepth(source, target compiler.Relation, direct map[compiler.Relation][]compiler.Relation) depthResult {
	depths := allShortestDepths(source, direct)
	depth, ok := depths[target]
	return depthResult{depth: depth, ok: ok}
}

func allShortestDepths(source compiler.Relation, direct map[compiler.Relation][]compiler.Relation) map[compiler.Relation]int {
	depths := map[compiler.Relation]int{source: 0}
	queue := []compiler.Relation{source}
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

func assertDenseEdgePositions(t testing.TB, catalog compiler.CatalogMutations) {
	t.Helper()
	byTarget := make(map[compiler.Relation][]int)
	for _, edge := range catalog.ExpressionEdges {
		byTarget[edge.Target] = append(byTarget[edge.Target], edge.Position)
	}
	for target, positions := range byTarget {
		slices.Sort(positions)
		for i, position := range positions {
			require.Equal(t, i, position, "expression edge positions for %v", target)
		}
	}
}

func assertPlansMatchEdges(t testing.TB, output compiler.Output) {
	t.Helper()
	edgesByTarget := make(map[compiler.Relation][]compiler.ExpressionEdge)
	for _, edge := range output.Catalog.ExpressionEdges {
		edgesByTarget[edge.Target] = append(edgesByTarget[edge.Target], edge)
	}

	seen := make(map[compiler.Relation]struct{}, len(output.Plans))
	for _, plan := range output.Plans {
		_, dup := seen[plan.Target]
		require.False(t, dup, "duplicate query plan for %v", plan.Target)
		seen[plan.Target] = struct{}{}

		edges := edgesByTarget[plan.Target]
		require.Len(t, plan.Terms, len(edges), "plan/edge count for %v", plan.Target)
		for i, edge := range edges {
			term := plan.Terms[i]
			require.Equal(t, edge.Kind, term.Kind, "term kind at %v[%d]", plan.Target, i)
			require.Equal(t, edge.Source, term.Source, "term source at %v[%d]", plan.Target, i)
			require.Equal(t, edge.Tupleset, term.Tupleset, "term tupleset at %v[%d]", plan.Target, i)
			if edge.Kind == compiler.TermDirect {
				require.NotNil(t, term.DirectReferences)
			}
		}
	}
}

func assertDenseReferencePositions(t testing.TB, catalog compiler.CatalogMutations) {
	t.Helper()
	byRelation := make(map[compiler.Relation][]int)
	for _, reference := range catalog.RelationReferences {
		byRelation[reference.Relation] = append(byRelation[reference.Relation], reference.Position)
	}
	for relation, positions := range byRelation {
		slices.Sort(positions)
		for i, position := range positions {
			require.Equal(t, i, position, "relation reference positions for %v", relation)
		}
	}
}

func assertNoDanglingEdgeTargets(
	t testing.TB,
	catalog compiler.CatalogMutations,
	relations map[compiler.Relation]struct{},
) {
	t.Helper()
	for _, edge := range catalog.ExpressionEdges {
		_, ok := relations[edge.Target]
		require.True(t, ok, "expression edge targets unknown relation %v", edge.Target)
		if edge.Kind == compiler.TermComputedUserset {
			_, ok = relations[edge.Source]
			require.True(t, ok, "computed userset source unknown %v", edge.Source)
		}
	}
	for _, implication := range catalog.Closure {
		_, ok := relations[implication.Source]
		require.True(t, ok, "closure source unknown %v", implication.Source)
		_, ok = relations[implication.Implied]
		require.True(t, ok, "closure implied unknown %v", implication.Implied)
	}
}

func TestCompileInvariants_RandomModels(t *testing.T) {
	t.Parallel()

	const iterations = 500
	for i := 0; i < iterations; i++ {
		model := authztest.GenerateModel(authztest.Seed(i))
		t.Run(fmt.Sprintf("seed_%d", i), func(t *testing.T) {
			t.Parallel()
			checkCompileInvariants(t, model)
		})
	}
}

func TestCompileInvariants_KnownValidSample(t *testing.T) {
	t.Parallel()

	model := parse(t, `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define viewer: [user, team#member] or member from team
    define editor: viewer
    define admin: [user] or editor
`)
	checkCompileInvariants(t, model)
}

func TestCompileInvariants_RejectsWithoutPartialOutput(t *testing.T) {
	t.Parallel()

	model := parse(t, `model
  schema 1.1

type user

type project
  relations
    define viewer: [user:*]
`)
	output, err := compiler.Compile(model)
	require.Error(t, err)
	require.Empty(t, output)
	require.True(t, errors.As(err, new(profile.Diagnostics)))
}
