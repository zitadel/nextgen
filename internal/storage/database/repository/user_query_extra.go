package repository

// UserQueryExtra is optional data for UserRepository reads, attached via [database.WithExtra].
type UserQueryExtra struct {
	ListScalarFilters []UserListScalarFilter
	// ListProject is required when ListScalarFilters is non-empty (strict project scoping for EAV match).
	ListProject string

	// ListTeamScope limits scalar list queries to attributes stored under the given team uniqueness scope.
	ListTeamScope *string

	AttributeKeys   []string
	WithAuthMethods bool
}

// UserListScalarFilter is an equality predicate on scalar EAV rows within a project.
type UserListScalarFilter struct {
	Key   string
	Value []byte // Canonical JSON encoding of the scalar (same bytes as stored jsonb).
}
