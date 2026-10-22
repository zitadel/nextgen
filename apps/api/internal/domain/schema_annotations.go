package domain

// Platform annotations read from tenant schema documents. One spelling
// each — a mistyped annotation does not fail loudly, it reads as absent.
const (
	// SchemaAnnotationIdentifier designates the leaf property whose value
	// identifies a user (ADR 058 §1). Schema-root, dot-joined path.
	SchemaAnnotationIdentifier = "x-identifier"
	// SchemaAnnotationDisplay lists the leaf property paths rendering the
	// user's display name (ADR 058 §2). Schema-root.
	SchemaAnnotationDisplay = "x-display"
	// SchemaAnnotationUnique carries a property's uniqueness scope.
	SchemaAnnotationUnique = "x-unique"
	// SchemaAnnotationAuthMethods configures the schema's auth methods.
	SchemaAnnotationAuthMethods = "x-auth-methods"
)

// Values of the [SchemaAnnotationUnique] annotation.
const (
	SchemaUniqueScopeProject = "project"
	SchemaUniqueScopeTeam    = "team"
)

// UniqueScopeOf maps an [SchemaAnnotationUnique] value to the uniqueness scope
// it declares. Anything else, including an absent annotation, is unspecified.
func UniqueScopeOf(annotation string) AttributeUniqueness {
	switch annotation {
	case SchemaUniqueScopeProject:
		return AttributeUniquenessProject
	case SchemaUniqueScopeTeam:
		return AttributeUniquenessTeam
	default:
		return AttributeUniquenessUnspecified
	}
}

// SchemaDocumentKindUser is the `kind` discriminator of a user schema
// document (distinct from [SchemaKindUser], the meta-schema filename stem).
const SchemaDocumentKindUser = "user-schema"
