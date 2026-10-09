package domain

import "time"

const PrefixUserPasskey ResourcePrefix = "upk"

type UserPasskey struct {
	ID              string
	ProjectID       string
	UserID          string
	CredentialID    string
	PublicKey       []byte
	AAGUID          []byte
	AttestationType *string
	Transports      []string
	SignCount       int64
	BackupEligible  bool
	BackupState     bool
	Name            string
	VerifiedAt      *time.Time
	LastUsedAt      *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type CreateUserPasskey struct {
	ID              string
	ProjectID       string
	UserID          string
	CredentialID    string
	PublicKey       []byte
	AAGUID          []byte
	AttestationType *string
	Transports      []string
	SignCount       int64
	UserVerified    bool
	BackupEligible  bool
	BackupState     bool
	Name            string
	VerifiedAt      *time.Time
}

// UserPasskeyField enumerates the fields of UserPasskey which can be used for
// filtering and ordering in list operations.
type UserPasskeyField uint8

const (
	UserPasskeyFieldUnspecified UserPasskeyField = iota
	UserPasskeyFieldID
	UserPasskeyFieldProjectID
	UserPasskeyFieldUserID
	UserPasskeyFieldCredentialID
	UserPasskeyFieldSignCount
	UserPasskeyFieldBackupEligible
	UserPasskeyFieldBackupState
	UserPasskeyFieldName
	UserPasskeyFieldVerifiedAt
	UserPasskeyFieldLastUsedAt
	UserPasskeyFieldCreatedAt
	UserPasskeyFieldUpdatedAt
)
