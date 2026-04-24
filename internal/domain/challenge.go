package domain

import "time"

type Challenge struct {
	// ProjectID links to [Project]
	// Unsure if it is needed in the challenge struct, but it is included for consistency and potential future use.
	ProjectID string
	// AuthAttemptID links to [AuthAttempt]
	// Unsure if it is needed in the challenge struct, but it is included for consistency and potential future use.
	AuthAttemptID string
	// ID is the unique identifier for the challenge within the project and auth attempt.
	// Unsure if it is needed in the challenge struct, but it is included for consistency and potential future use.
	ID string

	// When the challenge was last successfully completed.
	// This is used to determine if the challenge needs to be re-validated for subsequent auth attempts.
	LastSucceededAt time.Time
	// When the challenge was last failed.
	// This is used to determine if the challenge needs to be re-validated for subsequent auth attempts, and to implement lockout policies after a certain number of failed attempts.
	LastFailedAt time.Time
	// Times the challenge failed.
	FailureCount uint8

	// Type is the type of the challenge (e.g. "password", "otp", "webauthn", etc.). This is used to determine how to validate the challenge.
	Type ChallengeType
}

type ChallengeType interface {
	isChallengeType()
}
