package domain

// Platform annotations read from tenant schema documents. One spelling
// each — a mistyped annotation does not fail loudly, it reads as absent.
const (
	// SchemaAnnotationIdentifier designates the leaf property whose value
	// identifies a user (ADR 057 §1). Schema-root, dot-joined path.
	SchemaAnnotationIdentifier = "x-identifier"
	// SchemaAnnotationDisplay lists the leaf property paths rendering the
	// user's display name (ADR 057 §2). Schema-root.
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

// SchemaDocumentKindUser is the `kind` discriminator of a user schema
// document (distinct from [SchemaKindUser], the meta-schema filename stem).
const SchemaDocumentKindUser = "user-schema"
