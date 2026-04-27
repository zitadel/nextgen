package domain

import "time"

// Challenge represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#challenges)
// It is short lived and should therefore be stored near the client, do not store PII data in it.
type Challenge struct {
	// ProjectID links to [Project].
	// Unsure if it is needed in the challenge struct, but it is included for consistency and potential future use.
	ProjectID string
	// AuthAttemptID links to [AuthAttempt].
	// Unsure if it is needed in the challenge struct, but it is included for consistency and potential future use.
	AuthAttemptID string
	// ID is the unique identifier for the challenge within the project and auth attempt.
	// Unsure if it is needed in the challenge struct, because I assume that the type can only be challenged once per auth attempt, but it is included for consistency and potential future use.
	ID string

	// The time when the challenge was created.
	// The value is read only.
	// This is used to determine if the challenge is still valid (e.g. if it has expired after a certain amount of time).
	ChallengedAt time.Time
	// When the challenge was last successfully completed.
	// The value is read only.
	// This is used to determine if the challenge needs to be re-validated for subsequent auth attempts.
	LastSucceededAt time.Time
	// When the challenge was last failed.
	// The value is read only.
	// This is used to determine if the challenge needs to be re-validated for subsequent auth attempts, and to implement lockout policies after a certain number of failed attempts.
	LastFailedAt time.Time
	// Times the challenge failed.
	// The value is read only. Use increment and reset functions to modify it.
	FailureCount uint8

	// Type is the type of the challenge (e.g. [ChallengeTypeUser], [ChallengeTypePassword], "otp", "webauthn", etc.). This is used to determine how to validate the challenge.
	Type ChallengeType
}

type ChallengeType interface {
	isChallengeType()
}
