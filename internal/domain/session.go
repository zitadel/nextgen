package domain

// Session represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#sessions-durable-post-auth-only)
type Session struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the session within the project and user.
	ID string

	// UserID links to the [User] the session belongs to.
	// A session always belongs to a user, but a user may have multiple sessions (e.g. from different devices or browsers).
	UserID string

	// Multiple AuthAttempts can be handed off to a session, but a session can only be created after the first AuthAttempt is completed.
	// This means that the first AuthAttempt is always the one that creates the session, and any subsequent AuthAttempts are handed off to the existing session.
	AuthAttempts []*AuthAttempt
}
