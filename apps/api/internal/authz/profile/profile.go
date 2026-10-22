// Package profile enforces the bounded subset of OpenFGA that Zitadel can
// compile into portable relational query plans (ADR 032 §2).
//
// Supported: direct relations, computed usersets, union, userset references,
// and tuple-to-userset bounded by known hierarchy edges. Everything else is
// rejected at upload time with structured [Diagnostics] rather than failing or
// timing out during a check.
//
// Contextual tuples are not validated here because they are a check-time API
// input, not part of an authorization model; the resolver rejects them on
// request hot paths.
package profile

import (
	"fmt"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/authz"
)

// SupportedSchemaVersion is the only OpenFGA schema version the profile
// accepts. Modular models (1.2) are not planned for the MVP.
const SupportedSchemaVersion = "1.1"

// DefaultHierarchyTypes are the object types a tuple-to-userset may traverse.
// Bounding traversal to known edges keeps a check's join depth predictable on
// both PostgreSQL and Spanner.
var DefaultHierarchyTypes = []string{"app", "app_group", "project", "team", "user"}

// Validator checks a model against the supported profile.
type Validator struct {
	// HierarchyTypes bounds tuple-to-userset traversal.
	//   - nil: use [DefaultHierarchyTypes]
	//   - non-nil empty: allow no TTU edges (deny all hierarchy traversal)
	//   - non-empty: allow only the listed types
	HierarchyTypes []string
}

// Validate reports profile violations in model using the default hierarchy
// edges. It returns nil when the model compiles within the profile, and
// [Diagnostics] otherwise.
func Validate(model authz.Model) error {
	return Validator{}.Validate(model)
}

// Validate reports profile violations in model. It returns nil when the model
// compiles within the profile, and [Diagnostics] otherwise.
func (v Validator) Validate(model authz.Model) error {
	diagnostics := make(Diagnostics, 0)

	if model.SchemaVersion != SupportedSchemaVersion {
		diagnostics = append(diagnostics, Diagnostic{
			Code:    CodeUnsupportedSchemaVersion,
			Message: fmt.Sprintf("schema version %q is not supported, expected %q", model.SchemaVersion, SupportedSchemaVersion),
		})
	}

	// Caveats would need attribute evaluation outside the indexed join path,
	// so the MVP rejects every condition definition.
	for _, condition := range model.Conditions {
		diagnostics = append(diagnostics, Diagnostic{
			Code:      CodeUnsupportedCondition,
			Condition: condition.Name,
			Message:   "conditions are not supported",
		})
	}

	index := newIndex(model)
	for _, objectType := range model.Types {
		for _, relation := range objectType.Relations {
			diagnostics = append(diagnostics, v.validateRelation(index, objectType.Name, relation)...)
		}
	}
	diagnostics = append(diagnostics, index.recursionDiagnostics()...)

	if len(diagnostics) == 0 {
		return nil
	}
	return diagnostics
}

func (v Validator) validateRelation(index modelIndex, objectType string, relation authz.Relation) Diagnostics {
	diagnostics := v.validateTypeRestrictions(index, objectType, relation)
	return append(diagnostics, v.validateRewrite(index, objectType, relation, relation.Rewrite)...)
}

func (v Validator) validateTypeRestrictions(index modelIndex, objectType string, relation authz.Relation) Diagnostics {
	diagnostics := make(Diagnostics, 0)
	for _, reference := range relation.DirectlyRelatedTypes {
		diagnostic := Diagnostic{Type: objectType, Relation: relation.Name}

		switch {
		case reference.Wildcard:
			diagnostic.Code = CodeUnsupportedWildcard
			diagnostic.Message = fmt.Sprintf("wildcard restriction %q cannot be planned for list endpoints", reference.Type+":*")
		case reference.Condition != "":
			diagnostic.Code = CodeUnsupportedCondition
			diagnostic.Condition = reference.Condition
			diagnostic.Message = fmt.Sprintf("restriction %q carries a condition", reference.Type)
		case !index.hasType(reference.Type):
			diagnostic.Code = CodeTypeNotFound
			diagnostic.Message = fmt.Sprintf("restriction references undefined type %q", reference.Type)
		case reference.Relation != "" && !index.hasRelation(reference.Type, reference.Relation):
			diagnostic.Code = CodeRelationNotFound
			diagnostic.Message = fmt.Sprintf("restriction references undefined relation %q on type %q", reference.Relation, reference.Type)
		default:
			continue
		}

		diagnostics = append(diagnostics, diagnostic)
	}
	return diagnostics
}

func (v Validator) validateRewrite(index modelIndex, objectType string, relation authz.Relation, rewrite authz.Rewrite) Diagnostics {
	diagnostics := make(Diagnostics, 0)

	switch rewrite.Kind {
	case authz.RewriteDirect:
		if len(relation.DirectlyRelatedTypes) == 0 {
			diagnostics = append(diagnostics, Diagnostic{
				Code:     CodeMissingTypeRestriction,
				Type:     objectType,
				Relation: relation.Name,
				Message:  "direct assignment declares no type restrictions",
			})
		}
	case authz.RewriteComputedUserset:
		if !index.hasRelation(objectType, rewrite.Relation) {
			diagnostics = append(diagnostics, Diagnostic{
				Code:     CodeRelationNotFound,
				Type:     objectType,
				Relation: relation.Name,
				Message:  fmt.Sprintf("implies undefined relation %q", rewrite.Relation),
			})
		}
	case authz.RewriteTupleToUserset:
		diagnostics = append(diagnostics, v.validateTupleToUserset(index, objectType, relation, rewrite)...)
	case authz.RewriteUnion:
		if len(rewrite.Children) == 0 {
			diagnostics = append(diagnostics, Diagnostic{
				Code:     CodeEmptyRelationDefinition,
				Type:     objectType,
				Relation: relation.Name,
				Message:  "union has no children",
			})
			break
		}
		for _, child := range rewrite.Children {
			diagnostics = append(diagnostics, v.validateRewrite(index, objectType, relation, child)...)
		}
		if !rewriteHasAssignableLeaf(rewrite) {
			diagnostics = append(diagnostics, Diagnostic{
				Code:     CodeEmptyRelationDefinition,
				Type:     objectType,
				Relation: relation.Name,
				Message:  "relation has no assignable leaves",
			})
		}
	case authz.RewriteIntersection, authz.RewriteDifference:
		diagnostics = append(diagnostics, Diagnostic{
			Code:     CodeUnsupportedOperator,
			Type:     objectType,
			Relation: relation.Name,
			Message:  fmt.Sprintf("operator %q is not supported, the profile starts with union only", operatorName(rewrite.Kind)),
		})
	default:
		diagnostics = append(diagnostics, Diagnostic{
			Code:     CodeUnsupportedRewrite,
			Type:     objectType,
			Relation: relation.Name,
			Message:  "relation has no supported definition",
		})
	}

	return diagnostics
}

// validateTupleToUserset checks that "<relation> from <tupleset>" resolves
// through a directly assignable tupleset whose target types are known
// hierarchy edges and actually define the computed relation.
func (v Validator) validateTupleToUserset(index modelIndex, objectType string, relation authz.Relation, rewrite authz.Rewrite) Diagnostics {
	diagnostics := make(Diagnostics, 0)

	tupleset, ok := index.relation(objectType, rewrite.Tupleset)
	if !ok {
		return append(diagnostics, Diagnostic{
			Code:     CodeRelationNotFound,
			Type:     objectType,
			Relation: relation.Name,
			Message:  fmt.Sprintf("tupleset references undefined relation %q", rewrite.Tupleset),
		})
	}

	if tupleset.Rewrite.Kind != authz.RewriteDirect {
		diagnostics = append(diagnostics, Diagnostic{
			Code:     CodeUnboundedTupleToUserset,
			Type:     objectType,
			Relation: relation.Name,
			Message:  fmt.Sprintf("tupleset relation %q must be a direct assignment", rewrite.Tupleset),
		})
		return diagnostics
	}

	for _, reference := range tupleset.DirectlyRelatedTypes {
		if reference.Relation != "" || reference.Wildcard {
			diagnostics = append(diagnostics, Diagnostic{
				Code:     CodeUnboundedTupleToUserset,
				Type:     objectType,
				Relation: relation.Name,
				Message:  fmt.Sprintf("tupleset relation %q must restrict to plain types", rewrite.Tupleset),
			})
			continue
		}
		if !slices.Contains(v.hierarchyTypes(), reference.Type) {
			diagnostics = append(diagnostics, Diagnostic{
				Code:     CodeUnboundedTupleToUserset,
				Type:     objectType,
				Relation: relation.Name,
				Message:  fmt.Sprintf("type %q is not a known hierarchy edge: %s", reference.Type, formatHierarchy(v.hierarchyTypes())),
			})
			continue
		}
		if !index.hasRelation(reference.Type, rewrite.Relation) {
			diagnostics = append(diagnostics, Diagnostic{
				Code:     CodeRelationNotFound,
				Type:     objectType,
				Relation: relation.Name,
				Message:  fmt.Sprintf("type %q does not define relation %q", reference.Type, rewrite.Relation),
			})
		}
	}

	return diagnostics
}

func (v Validator) hierarchyTypes() []string {
	if v.HierarchyTypes == nil {
		return DefaultHierarchyTypes
	}
	return v.HierarchyTypes
}

func rewriteHasAssignableLeaf(rewrite authz.Rewrite) bool {
	switch rewrite.Kind {
	case authz.RewriteDirect, authz.RewriteComputedUserset, authz.RewriteTupleToUserset:
		return true
	case authz.RewriteUnion:
		for _, child := range rewrite.Children {
			if rewriteHasAssignableLeaf(child) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func formatHierarchy(types []string) string {
	if len(types) == 0 {
		return "(none)"
	}
	quoted := make([]string, len(types))
	for i, objectType := range types {
		quoted[i] = fmt.Sprintf("%q", objectType)
	}
	return strings.Join(quoted, ", ")
}

func operatorName(kind authz.RewriteKind) string {
	if kind == authz.RewriteIntersection {
		return "and"
	}
	return "but not"
}
