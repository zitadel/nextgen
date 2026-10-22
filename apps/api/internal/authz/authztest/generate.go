// Package authztest holds shared helpers for authz property and integration
// tests. See docs/design/api/authz-testing.md.
package authztest

import (
	"hash/fnv"
	"math/rand"
	"slices"
	"sort"

	"github.com/zitadel/nextgen/internal/authz"
	"github.com/zitadel/nextgen/internal/authz/profile"
)

type genMode uint8

const (
	mixed genMode = iota
	validOnly
)

var (
	hierarchyTypeNames = []string{"user", "team", "project", "app", "app_group"}
	extraTypeNames     = []string{"document", "folder", "org"}
	relationNames      = []string{"member", "viewer", "editor", "admin", "parent", "owner", "assignee"}
	typePool           = append(append([]string{}, hierarchyTypeNames...), extraTypeNames...)
)

// GenerateModel builds a schema 1.1 authz.Model from entropy for L2 property
// and fuzz tests. Named recipe tables drive rewrites/refs; mixed mode injects
// occasional invalid constructs for rejection coverage.
func GenerateModel(data []byte) authz.Model {
	return generate(rand.New(rand.NewSource(seedFrom(data))), mixed)
}

// GenerateValidModel builds only profile-valid models for L3 persist tests.
func GenerateValidModel(data []byte) authz.Model {
	return generate(rand.New(rand.NewSource(seedFrom(data))), validOnly)
}

func generate(src *rand.Rand, mode genMode) authz.Model {
	typeNames := chooseTypes(src, mode)
	relationsByType := chooseRelations(src, mode, typeNames)

	model := authz.Model{
		SchemaVersion: profile.SupportedSchemaVersion,
		Types:         make([]authz.Type, 0, len(typeNames)),
	}
	applyModelDefect(src, &model, selectModelDefect(src, mode))

	for _, typeName := range typeNames {
		objectType := authz.Type{Name: typeName}
		rels := relationsByType[typeName]
		for idx, relationName := range rels {
			rwRecipe, refRecipe := selectRelationRecipes(src, mode, idx)
			objectType.Relations = append(objectType.Relations, authz.Relation{
				Name:                 relationName,
				Rewrite:              applyRewrite(src, rwRecipe, rels, idx),
				DirectlyRelatedTypes: applyRefs(src, refRecipe, typeNames, relationsByType),
			})
		}
		model.Types = append(model.Types, objectType)
	}

	sortModel(&model)
	return model
}

func chooseTypes(src *rand.Rand, mode genMode) []string {
	typeCount := 1 + src.Intn(min(4, len(typePool)))
	if mode == validOnly && typeCount < 2 {
		// Ensure at least one non-user type so catalogs have relations to persist.
		typeCount = 2
	}
	typeNames := make([]string, 0, typeCount)
	typeNames = append(typeNames, "user")
	for _, candidate := range shuffleStrings(src, typePool) {
		if len(typeNames) >= typeCount {
			break
		}
		if slices.Contains(typeNames, candidate) {
			continue
		}
		typeNames = append(typeNames, candidate)
	}
	return typeNames
}

func chooseRelations(src *rand.Rand, mode genMode, typeNames []string) map[string][]string {
	relationsByType := make(map[string][]string, len(typeNames))
	for _, typeName := range typeNames {
		count := 0
		switch {
		case typeName == "user":
			if mode == mixed {
				count = src.Intn(2) // 0 or 1
			}
		case mode == validOnly:
			count = 1 + src.Intn(min(3, len(relationNames)))
		default:
			count = src.Intn(min(4, len(relationNames)+1))
			if count == 0 && src.Intn(2) == 0 {
				count = 1 + src.Intn(min(3, len(relationNames)))
			}
		}
		names := make([]string, 0, count)
		for _, name := range shuffleStrings(src, relationNames) {
			if len(names) >= count {
				break
			}
			names = append(names, name)
		}
		relationsByType[typeName] = names
	}
	return relationsByType
}

// Seed returns deterministic entropy for GenerateModel from an integer index.
func Seed(i int) []byte {
	return []byte{
		byte(i), byte(i >> 8), byte(i >> 16), byte(i * 3),
		byte(i * 5), byte(i * 7), byte(i * 11), byte(i * 13),
		byte(i + 17), byte(i + 19), byte(i + 23), byte(i + 29),
		byte(i * i), byte(i + 31), byte(i + 37), byte(i + 41),
	}
}

func seedFrom(data []byte) int64 {
	h := fnv.New64a()
	_, _ = h.Write(data)
	return int64(h.Sum64())
}

func pick(src *rand.Rand, values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[src.Intn(len(values))]
}

func sortModel(model *authz.Model) {
	sort.Slice(model.Types, func(i, j int) bool {
		return model.Types[i].Name < model.Types[j].Name
	})
	for i := range model.Types {
		rels := model.Types[i].Relations
		sort.Slice(rels, func(a, b int) bool {
			return rels[a].Name < rels[b].Name
		})
		for j := range rels {
			refs := rels[j].DirectlyRelatedTypes
			sort.Slice(refs, func(a, b int) bool {
				return refLess(refs[a], refs[b])
			})
		}
	}
}

func refLess(left, right authz.RelationReference) bool {
	if left.Type != right.Type {
		return left.Type < right.Type
	}
	if left.Relation != right.Relation {
		return left.Relation < right.Relation
	}
	if left.Wildcard != right.Wildcard {
		return !left.Wildcard
	}
	return left.Condition < right.Condition
}

func shuffleStrings(src *rand.Rand, values []string) []string {
	out := append([]string{}, values...)
	src.Shuffle(len(out), func(i, j int) {
		out[i], out[j] = out[j], out[i]
	})
	return out
}
