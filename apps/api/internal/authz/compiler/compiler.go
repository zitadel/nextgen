package compiler

import (
	"slices"

	"github.com/zitadel/nextgen/internal/authz"
	"github.com/zitadel/nextgen/internal/authz/profile"
)

// Compiler validates and compiles authorization models. Validator controls the
// allowed tuple-to-userset hierarchy; its zero value uses the ADR 032 defaults.
type Compiler struct {
	Validator profile.Validator
}

// Compile validates and compiles model using the default profile.
func Compile(model authz.Model) (Output, error) {
	return Compiler{}.Compile(model)
}

// Compile validates model before producing any output. Profile diagnostics are
// returned unchanged so an API boundary can expose them as domain-error
// details.
func (c Compiler) Compile(model authz.Model) (Output, error) {
	if err := c.Validator.Validate(model); err != nil {
		return Output{}, err
	}

	output := Output{
		Catalog: CatalogMutations{
			SchemaVersion: model.SchemaVersion,
			Types:         make([]TypeDefinition, 0, len(model.Types)),
		},
	}
	directImplications := make(map[Relation][]Relation)

	for _, objectType := range model.Types {
		output.Catalog.Types = append(output.Catalog.Types, TypeDefinition{Name: objectType.Name})

		for _, relation := range objectType.Relations {
			target := Relation{Type: objectType.Name, Name: relation.Name}
			output.Catalog.Relations = append(output.Catalog.Relations, RelationDefinition{Relation: target})

			for position, reference := range relation.DirectlyRelatedTypes {
				output.Catalog.RelationReferences = append(output.Catalog.RelationReferences, RelationReference{
					Relation:  target,
					Reference: reference,
					Position:  position,
				})
			}

			terms := flattenTerms(model, target, relation)
			plan := QueryPlan{
				Target: target,
				Terms:  make([]QueryTerm, 0, len(terms)),
			}
			for position, term := range terms {
				output.Catalog.ExpressionEdges = append(output.Catalog.ExpressionEdges, ExpressionEdge{
					Target:   target,
					Kind:     term.Kind,
					Source:   term.Source,
					Tupleset: term.Tupleset,
					Position: position,
				})
				plan.Terms = append(plan.Terms, term)

				// A computed userset is a schema-level implication on the
				// same object: "define editor: viewer" means viewer -> editor.
				// TTU and userset references need object joins and remain in
				// the query plan instead.
				if term.Kind == TermComputedUserset {
					directImplications[term.Source] = append(directImplications[term.Source], target)
				}
			}
			output.Plans = append(output.Plans, plan)
		}
	}

	output.Catalog.Closure = computeClosure(output.Catalog.Relations, directImplications)
	return output, nil
}

// flattenTerms lowers the supported expression tree into OR terms. Profile
// validation guarantees that only direct, computed-userset, TTU, and union
// nodes reach this function.
func flattenTerms(model authz.Model, target Relation, relation authz.Relation) []QueryTerm {
	return flattenRewrite(model, target, relation.DirectlyRelatedTypes, relation.Rewrite)
}

func flattenRewrite(
	model authz.Model,
	target Relation,
	directReferences []authz.RelationReference,
	rewrite authz.Rewrite,
) []QueryTerm {
	switch rewrite.Kind {
	case authz.RewriteDirect:
		return []QueryTerm{{
			Kind:             TermDirect,
			DirectReferences: slices.Clone(directReferences),
		}}
	case authz.RewriteComputedUserset:
		return []QueryTerm{{
			Kind:   TermComputedUserset,
			Source: Relation{Type: target.Type, Name: rewrite.Relation},
		}}
	case authz.RewriteTupleToUserset:
		tupleset := lookupRelation(model, target.Type, rewrite.Tupleset)
		terms := make([]QueryTerm, 0, len(tupleset.DirectlyRelatedTypes))
		for _, reference := range tupleset.DirectlyRelatedTypes {
			terms = append(terms, QueryTerm{
				Kind:     TermTupleToUserset,
				Source:   Relation{Type: reference.Type, Name: rewrite.Relation},
				Tupleset: Relation{Type: target.Type, Name: rewrite.Tupleset},
			})
		}
		return terms
	case authz.RewriteUnion:
		var terms []QueryTerm
		for _, child := range rewrite.Children {
			terms = append(terms, flattenRewrite(model, target, directReferences, child)...)
		}
		return dedupeTerms(terms)
	default:
		// Unreachable after profile validation.
		return nil
	}
}

func dedupeTerms(terms []QueryTerm) []QueryTerm {
	out := make([]QueryTerm, 0, len(terms))
	for _, term := range terms {
		if containsTerm(out, term) {
			continue
		}
		out = append(out, term)
	}
	return out
}

func containsTerm(terms []QueryTerm, want QueryTerm) bool {
	for _, candidate := range terms {
		if queryTermsEqual(candidate, want) {
			return true
		}
	}
	return false
}

func queryTermsEqual(left, right QueryTerm) bool {
	return left.Kind == right.Kind &&
		left.Source == right.Source &&
		left.Tupleset == right.Tupleset &&
		slices.Equal(left.DirectReferences, right.DirectReferences)
}

func lookupRelation(model authz.Model, objectType, relationName string) authz.Relation {
	for _, candidateType := range model.Types {
		if candidateType.Name != objectType {
			continue
		}
		for _, relation := range candidateType.Relations {
			if relation.Name == relationName {
				return relation
			}
		}
	}
	return authz.Relation{}
}
