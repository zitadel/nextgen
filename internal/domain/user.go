package domain

type User struct {
	// ProjectID links to [Project]
	ProjectID string
	// TeamID links to [Team]. A user may belong to a team, but it's not required.
	// If TeamID is nil, the user belongs to the project but not to any team.
	TeamID *string
	// ID is the unique identifier for the user within the project and team.
	ID string
}
