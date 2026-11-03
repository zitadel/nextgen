package domain

import (
	"time"
)

const PrefixUserRecoveryCodes ResourcePrefix = "urc"

type UserRecoveryCodes struct {
	ID                  string
	ProjectID           string
	UserID              string
	RecoveryCodes       []string
	LastSuccessfulCheck *time.Time
	FailedAttempts      int16
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type CreateRecoveryCodes struct {
	ID            string
	ProjectID     string
	UserID        string
	RecoveryCodes []string
}

// UserRecoveryCodesField enumerates the fields of UserRecoveryCodes which can be
// used for filtering and ordering in list operations.
type UserRecoveryCodesField uint8

const (
	UserRecoveryCodesFieldUnspecified UserRecoveryCodesField = iota
	UserRecoveryCodesFieldID
	UserRecoveryCodesFieldProjectID
	UserRecoveryCodesFieldUserID
	UserRecoveryCodesFieldRecoveryCodes
	UserRecoveryCodesFieldLastSuccessfulCheck
	UserRecoveryCodesFieldFailedAttempts
	UserRecoveryCodesFieldCreatedAt
	UserRecoveryCodesFieldUpdatedAt
)
