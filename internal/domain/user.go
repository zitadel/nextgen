package domain

// User represents the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#users)
// The user might contain PII data and should be stored in a specific region.
type User struct {
	// ProjectID links to [Project].
	ProjectID string
	// TeamID links to [Team]. A user may belong to a team, but it's not required.
	// If TeamID is nil, the user belongs to the project but not to any team.
	TeamID *string
	// ID is the unique identifier for the user within the project and team.
	ID string
}
