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
