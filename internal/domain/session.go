package domain

// Session represents the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#sessions-durable-post-auth-only)
type Session struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the session within the project and user.
	ID string

	// UserID links to the [User] the session belongs to once associated.
	// A user may have multiple sessions (e.g. from different devices or browsers), and UserID may be nil during some lifecycle stages.
	UserID *string

	// AuthAttempts are deleted as soon as they are handed off to a session and are therefore not accessible on a session.
}
