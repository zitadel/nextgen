package domain

import (
	"time"
)

type UserTOTP struct {
	ID                  int64
	ProjectID           string
	UserID              string
	Secret              []byte
	VerifiedAt          time.Time
	LastSuccessfulCheck *time.Time
	FailedAttempts      int16
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type CreateUserTOTP struct {
	ProjectID string
	UserID    string
	Secret    []byte
}

// UserTOTPField enumerates the fields of UserTOTP which can be used for
// filtering and ordering in list operations.
type UserTOTPField uint8

const (
	UserTOTPFieldUnspecified UserTOTPField = iota
	UserTOTPFieldID
	UserTOTPFieldProjectID
	UserTOTPFieldUserID
	UserTOTPFieldSecret
	UserTOTPFieldVerifiedAt
	UserTOTPFieldLastSuccessfulCheck
	UserTOTPFieldFailedAttempts
	UserTOTPFieldCreatedAt
	UserTOTPFieldUpdatedAt
)
