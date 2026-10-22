// Package openfga adapts the upstream OpenFGA language package into Zitadel's
// authz IR. Parsing and syntactic validation stay upstream; this package only
// normalizes the protobuf AuthorizationModel into [authz.Model].
//
// Semantic profile checks (unsupported constructs, hierarchy bounds) belong in
// internal/authz/profile, not here.
package openfga

import (
	"fmt"
	"sort"
	"strings"

	openfgav1 "github.com/openfga/api/proto/openfga/v1"
	"github.com/openfga/language/pkg/go/transformer"

	"github.com/zitadel/nextgen/internal/authz"
)

// ParseDSL parses an OpenFGA DSL model and normalizes it into Zitadel's
// storage-independent authorization model.
func ParseDSL(input string) (authz.Model, error) {
	model, err := transformer.TransformDSLToProto(input)
	if err != nil {
		return authz.Model{}, fmt.Errorf("parse OpenFGA DSL: %w", err)
	}
	return normalize(model)
}

// ParseJSON parses an OpenFGA JSON model and normalizes it into Zitadel's
// storage-independent authorization model.
func ParseJSON(input string) (authz.Model, error) {
	model, err := transformer.LoadJSONStringToProto(input)
	if err != nil {
		return authz.Model{}, fmt.Errorf("parse OpenFGA JSON: %w", err)
	}
	return normalize(model)
}

// normalize converts an upstream AuthorizationModel into authz.Model.
// Map iteration order is unstable, so types, relations, and conditions are
// sorted by name.
func normalize(model *openfgav1.AuthorizationModel) (authz.Model, error) {
	if model == nil {
		return authz.Model{}, fmt.Errorf("normalize OpenFGA model: model is nil")
	}

	result := authz.Model{
		SchemaVersion: model.GetSchemaVersion(),
		Types:         make([]authz.Type, 0, len(model.GetTypeDefinitions())),
		Conditions:    make([]authz.Condition, 0, len(model.GetConditions())),
	}

	for _, definition := range model.GetTypeDefinitions() {
		normalized, err := normalizeType(definition)
		if err != nil {
			return authz.Model{}, err
		}
		result.Types = append(result.Types, normalized)
	}
	sort.Slice(result.Types, func(i, j int) bool {
		return result.Types[i].Name < result.Types[j].Name
	})

	for name, condition := range model.GetConditions() {
		result.Conditions = append(result.Conditions, normalizeCondition(name, condition))
	}
	sort.Slice(result.Conditions, func(i, j int) bool {
		return result.Conditions[i].Name < result.Conditions[j].Name
	})

	return result, nil
}

func normalizeType(definition *openfgav1.TypeDefinition) (authz.Type, error) {
	if definition == nil {
		return authz.Type{}, fmt.Errorf("normalize OpenFGA model: type definition is nil")
	}

	result := authz.Type{
		Name:      definition.GetType(),
		Relations: make([]authz.Relation, 0, len(definition.GetRelations())),
	}

	for name, rewrite := range definition.GetRelations() {
		normalizedRewrite, err := normalizeRewrite(rewrite)
		if err != nil {
			return authz.Type{}, fmt.Errorf("normalize OpenFGA relation %q.%q: %w", result.Name, name, err)
		}

		relation := authz.Relation{
			Name:    name,
			Rewrite: normalizedRewrite,
		}
		// Direct type restrictions live in relation metadata, not in the
		// DirectUserset ("this") rewrite itself.
		if metadata := definition.GetMetadata().GetRelations()[name]; metadata != nil {
			relation.DirectlyRelatedTypes = normalizeRelationReferences(metadata.GetDirectlyRelatedUserTypes())
		}
		result.Relations = append(result.Relations, relation)
	}
	sort.Slice(result.Relations, func(i, j int) bool {
		return result.Relations[i].Name < result.Relations[j].Name
	})

	return result, nil
}

func normalizeRelationReferences(references []*openfgav1.RelationReference) []authz.RelationReference {
	result := make([]authz.RelationReference, 0, len(references))
	for _, reference := range references {
		if reference == nil {
			continue
		}
		result = append(result, authz.RelationReference{
			Type:      reference.GetType(),
			Relation:  reference.GetRelation(),
			Wildcard:  reference.GetWildcard() != nil,
			Condition: reference.GetCondition(),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		left, right := result[i], result[j]
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
	})
	return result
}

// normalizeRewrite maps OpenFGA's oneof Userset into authz.Rewrite.
// DirectUserset is an empty protobuf message, so GetThis() is unreliable;
// switch on the oneof discriminator instead.
func normalizeRewrite(rewrite *openfgav1.Userset) (authz.Rewrite, error) {
	if rewrite == nil {
		return authz.Rewrite{}, fmt.Errorf("rewrite is nil")
	}

	switch rewrite.GetUserset().(type) {
	case *openfgav1.Userset_This:
		return authz.Rewrite{Kind: authz.RewriteDirect}, nil
	case *openfgav1.Userset_ComputedUserset:
		return authz.Rewrite{
			Kind:     authz.RewriteComputedUserset,
			Relation: rewrite.GetComputedUserset().GetRelation(),
		}, nil
	case *openfgav1.Userset_TupleToUserset:
		return authz.Rewrite{
			Kind:     authz.RewriteTupleToUserset,
			Relation: rewrite.GetTupleToUserset().GetComputedUserset().GetRelation(),
			Tupleset: rewrite.GetTupleToUserset().GetTupleset().GetRelation(),
		}, nil
	case *openfgav1.Userset_Union:
		return normalizeChildren(authz.RewriteUnion, rewrite.GetUnion().GetChild())
	case *openfgav1.Userset_Intersection:
		return normalizeChildren(authz.RewriteIntersection, rewrite.GetIntersection().GetChild())
	case *openfgav1.Userset_Difference:
		base, err := normalizeRewrite(rewrite.GetDifference().GetBase())
		if err != nil {
			return authz.Rewrite{}, fmt.Errorf("normalize difference base: %w", err)
		}
		subtract, err := normalizeRewrite(rewrite.GetDifference().GetSubtract())
		if err != nil {
			return authz.Rewrite{}, fmt.Errorf("normalize difference subtract: %w", err)
		}
		return authz.Rewrite{
			Kind:     authz.RewriteDifference,
			Children: []authz.Rewrite{base, subtract},
		}, nil
	default:
		return authz.Rewrite{}, fmt.Errorf("unsupported userset rewrite type %T", rewrite.GetUserset())
	}
}

func normalizeChildren(kind authz.RewriteKind, children []*openfgav1.Userset) (authz.Rewrite, error) {
	result := authz.Rewrite{
		Kind:     kind,
		Children: make([]authz.Rewrite, 0, len(children)),
	}
	for i, child := range children {
		normalized, err := normalizeRewrite(child)
		if err != nil {
			return authz.Rewrite{}, fmt.Errorf("normalize child %d: %w", i, err)
		}
		result.Children = append(result.Children, normalized)
	}
	return result, nil
}

func normalizeCondition(name string, condition *openfgav1.Condition) authz.Condition {
	result := authz.Condition{Name: name}
	if condition == nil {
		return result
	}

	result.Expression = condition.GetExpression()
	result.Parameters = make([]authz.ConditionParameter, 0, len(condition.GetParameters()))
	for parameterName, parameterType := range condition.GetParameters() {
		result.Parameters = append(result.Parameters, authz.ConditionParameter{
			Name: parameterName,
			Type: normalizeConditionParameterType(parameterType),
		})
	}
	sort.Slice(result.Parameters, func(i, j int) bool {
		return result.Parameters[i].Name < result.Parameters[j].Name
	})
	return result
}

func normalizeConditionParameterType(parameterType *openfgav1.ConditionParamTypeRef) authz.ConditionParameterType {
	if parameterType == nil {
		return authz.ConditionParameterType{}
	}

	result := authz.ConditionParameterType{
		// Proto enums are TYPE_NAME_TIMESTAMP; IR keeps the lower-case DSL form.
		Name: strings.ToLower(strings.TrimPrefix(parameterType.GetTypeName().String(), "TYPE_NAME_")),
	}
	for _, generic := range parameterType.GetGenericTypes() {
		result.Generics = append(result.Generics, normalizeConditionParameterType(generic))
	}
	return result
}
