package domain

// AuthAttempt represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#auth-flows)
type AuthAttempt struct {
	// ProjectID links to [Project]
	ProjectID string
	// ID is the unique identifier for the auth attempt within the project.
	ID string
	// Challenges links to the [Challenge]s that belong to the auth attempt.
	// An auth attempt can have multiple challenges (e.g. for multi-factor authentication), but a challenge can only belong to one auth attempt.
	Challenges []Challenge
}
