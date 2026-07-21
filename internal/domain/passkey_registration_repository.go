package domain

import (
	"time"
)

const PrefixPasskeyRegistration ResourcePrefix = "pkreg"

func ErrPasskeyRegistrationNotFound() Error {
	return newError(PrefixPasskeyRegistration.ErrorCodePrefix("not_found"), "passkey registration session not found or expired", nil, nil)
}

// PasskeyRegistration is a pending WebAuthn registration session. It is
// created by BeginRegistration and consumed (then deleted) by FinishRegistration.
type PasskeyRegistration struct {
	ID        string
	ProjectID string
	UserID    string
	Challenge *PasskeyRegistrationChallenge
	ExpiresAt time.Time
	CreatedAt time.Time
}

// CreatePasskeyRegistration is the input DTO for persisting a new session.
type CreatePasskeyRegistration struct {
	ID        string
	ProjectID string
	UserID    string
	Challenge *PasskeyRegistrationChallenge
	ExpiresAt time.Time
}

// PasskeyRegistrationField enumerates the fields of PasskeyRegistration which can
// be used for filtering and ordering in storage statements.
type PasskeyRegistrationField uint8

const (
	PasskeyRegistrationFieldUnspecified PasskeyRegistrationField = iota
	PasskeyRegistrationFieldID
	PasskeyRegistrationFieldProjectID
	PasskeyRegistrationFieldUserID
	PasskeyRegistrationFieldChallenge
	PasskeyRegistrationFieldExpiresAt
	PasskeyRegistrationFieldCreatedAt
)
