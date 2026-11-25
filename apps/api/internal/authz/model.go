// Package authz holds the shared intermediate representation for permission
// catalogs. OpenFGA DSL/JSON is normalized into these types by
// [github.com/zitadel/nextgen/internal/authz/openfga]; profile validation and
// compilation consume the same Model without depending on OpenFGA protobufs.
package authz

// Model is the storage-independent representation of an OpenFGA authorization
// model. Types and Conditions are sorted by name for deterministic comparison
// in tests and later catalog diffs.
type Model struct {
	SchemaVersion string
	Types         []Type
	Conditions    []Condition
}

// Type is an OpenFGA object type (e.g. project, team, user).
type Type struct {
	Name      string
	Relations []Relation
}

// Relation is a named permission or relationship on a Type, including its
// rewrite expression and the type restrictions that apply to direct
// assignments (the [user] / [team#member] lists in the DSL).
type Relation struct {
	Name                 string
	Rewrite              Rewrite
	DirectlyRelatedTypes []RelationReference
}

// RelationReference is a direct-assignment type restriction, e.g. user,
// team#member, user:*, or user with non_expired.
type RelationReference struct {
	Type      string
	Relation  string // userset restriction (#relation); empty when unset
	Wildcard  bool   // true for type:*
	Condition string // caveat name attached with "with"; empty when unset
}

// RewriteKind identifies which OpenFGA userset construct a Rewrite encodes.
type RewriteKind uint8

const (
	RewriteInvalid         RewriteKind = iota
	RewriteDirect                      // [user, ...] — this / direct assignment
	RewriteComputedUserset             // define editor: viewer
	RewriteTupleToUserset              // define viewer: member from team
	RewriteUnion                       // a or b
	RewriteIntersection                // a and b
	RewriteDifference                  // a but not b
)

// Rewrite is one relation expression. Field use depends on Kind:
//   - RewriteComputedUserset: Relation is the implied relation name
//   - RewriteTupleToUserset: Relation is the computed userset; Tupleset is the
//     tupleset relation (DSL: "<Relation> from <Tupleset>")
//   - RewriteUnion / RewriteIntersection: Children are the operands
//   - RewriteDifference: Children are [base, subtract]
type Rewrite struct {
	Kind     RewriteKind
	Relation string
	Tupleset string
	Children []Rewrite
}

// Condition is an OpenFGA caveat definition. Profile validation rejects these
// for the MVP when they require non-indexed attribute evaluation; they are
// still preserved in the IR so diagnostics can name them.
type Condition struct {
	Name       string
	Expression string
	Parameters []ConditionParameter
}

// ConditionParameter is a named parameter of a Condition.
type ConditionParameter struct {
	Name string
	Type ConditionParameterType
}

// ConditionParameterType is an OpenFGA condition parameter type such as
// timestamp or list<string>. Name is the lower-case type without the
// TYPE_NAME_ proto prefix; Generics holds nested types for list/map.
type ConditionParameterType struct {
	Name     string
	Generics []ConditionParameterType
}
