package authztest

import (
	"math/rand"

	"github.com/zitadel/nextgen/internal/authz"
)

type rewriteRecipe uint8

const (
	rewriteDirect rewriteRecipe = iota
	rewriteComputed
	rewriteUnionDirectComputed
	rewriteIntersection
	rewriteDifference
	rewriteTTUInvalid
)

type refRecipe uint8

const (
	refPlain refRecipe = iota
	refUserset
	refEmpty
	refWildcard
	refConditioned
)

type modelDefect uint8

const (
	defectNone modelDefect = iota
	defectSchema
	defectCondition
)

var (
	validRewriteRecipes = []rewriteRecipe{
		rewriteDirect,
		rewriteComputed,
		rewriteUnionDirectComputed,
	}
	invalidRewriteRecipes = []rewriteRecipe{
		rewriteIntersection,
		rewriteDifference,
		rewriteTTUInvalid,
	}

	validRefRecipes = []refRecipe{
		refPlain,
		refUserset,
	}
	// validOnlyRefRecipes stay acyclic: userset restrictions create reference
	// edges that can cycle with computed usersets across types.
	validOnlyRefRecipes = []refRecipe{
		refPlain,
	}
	invalidRefRecipes = []refRecipe{
		refEmpty,
		refWildcard,
		refConditioned,
	}
)

func pickRecipe[T ~uint8](src *rand.Rand, recipes []T) T {
	return recipes[src.Intn(len(recipes))]
}

func applyRewrite(src *rand.Rand, recipe rewriteRecipe, rels []string, relationIndex int) authz.Rewrite {
	prior := rels[:relationIndex]

	// First relation needs a direct base (or an invalid recipe in mixed mode).
	if relationIndex == 0 {
		switch recipe {
		case rewriteIntersection:
			return unsupportedBinary(authz.RewriteIntersection)
		case rewriteDifference:
			return unsupportedBinary(authz.RewriteDifference)
		default:
			return authz.Rewrite{Kind: authz.RewriteDirect}
		}
	}

	switch recipe {
	case rewriteDirect:
		return authz.Rewrite{Kind: authz.RewriteDirect}
	case rewriteComputed:
		return authz.Rewrite{
			Kind:     authz.RewriteComputedUserset,
			Relation: pick(src, prior),
		}
	case rewriteUnionDirectComputed:
		return authz.Rewrite{
			Kind: authz.RewriteUnion,
			Children: []authz.Rewrite{
				{Kind: authz.RewriteDirect},
				{Kind: authz.RewriteComputedUserset, Relation: pick(src, prior)},
			},
		}
	case rewriteIntersection:
		return unsupportedBinary(authz.RewriteIntersection)
	case rewriteDifference:
		return unsupportedBinary(authz.RewriteDifference)
	case rewriteTTUInvalid:
		return authz.Rewrite{
			Kind:     authz.RewriteTupleToUserset,
			Relation: "ghost_" + pick(src, relationNames),
			Tupleset: rels[0],
		}
	default:
		return authz.Rewrite{Kind: authz.RewriteDirect}
	}
}

func unsupportedBinary(kind authz.RewriteKind) authz.Rewrite {
	return authz.Rewrite{
		Kind: kind,
		Children: []authz.Rewrite{
			{Kind: authz.RewriteDirect},
			{Kind: authz.RewriteDirect},
		},
	}
}

func applyRefs(
	src *rand.Rand,
	recipe refRecipe,
	typeNames []string,
	relationsByType map[string][]string,
) []authz.RelationReference {
	switch recipe {
	case refEmpty:
		return nil
	case refWildcard:
		return []authz.RelationReference{{Type: pick(src, typeNames), Wildcard: true}}
	case refConditioned:
		return []authz.RelationReference{{Type: pick(src, typeNames), Condition: "non_expired"}}
	case refUserset:
		refType := pick(src, typeNames)
		ref := authz.RelationReference{Type: refType}
		if rels := relationsByType[refType]; len(rels) > 0 {
			ref.Relation = pick(src, rels)
			return []authz.RelationReference{ref}
		}
		fallthrough
	case refPlain:
		count := 1 + src.Intn(2)
		refs := make([]authz.RelationReference, 0, count)
		for i := 0; i < count; i++ {
			refs = append(refs, authz.RelationReference{Type: pick(src, typeNames)})
		}
		return refs
	default:
		return []authz.RelationReference{{Type: pick(src, typeNames)}}
	}
}

func applyModelDefect(src *rand.Rand, model *authz.Model, defect modelDefect) {
	switch defect {
	case defectSchema:
		model.SchemaVersion = "1.2"
	case defectCondition:
		model.Conditions = []authz.Condition{{
			Name:       "non_expired",
			Expression: "true",
		}}
	case defectNone:
	}
}

func selectValidRewriteRecipe(src *rand.Rand, relationIndex int) rewriteRecipe {
	if relationIndex == 0 {
		return rewriteDirect
	}
	return pickRecipe(src, validRewriteRecipes)
}

func selectInvalidRewriteRecipe(src *rand.Rand, relationIndex int) rewriteRecipe {
	if relationIndex == 0 {
		return pickRecipe(src, []rewriteRecipe{rewriteIntersection, rewriteDifference})
	}
	return pickRecipe(src, invalidRewriteRecipes)
}

// selectRelationRecipes picks rewrite + ref recipes. In mixed mode, ~1/5 of
// relations inject exactly one invalid construct (rewrite or refs, not both).
func selectRelationRecipes(src *rand.Rand, mode genMode, relationIndex int) (rewriteRecipe, refRecipe) {
	if mode == validOnly {
		return selectValidRewriteRecipe(src, relationIndex), pickRecipe(src, validOnlyRefRecipes)
	}
	if src.Intn(5) != 0 {
		return selectValidRewriteRecipe(src, relationIndex), pickRecipe(src, validRefRecipes)
	}
	if src.Intn(2) == 0 {
		return selectInvalidRewriteRecipe(src, relationIndex), pickRecipe(src, validRefRecipes)
	}
	return selectValidRewriteRecipe(src, relationIndex), pickRecipe(src, invalidRefRecipes)
}

func selectModelDefect(src *rand.Rand, mode genMode) modelDefect {
	if mode == validOnly {
		return defectNone
	}
	switch src.Intn(10) {
	case 0:
		return defectSchema
	case 1:
		return defectCondition
	default:
		return defectNone
	}
}
