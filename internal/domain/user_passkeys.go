package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserPasskey struct {
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
	CreatedAt       *time.Time
	UpdatedAt       *time.Time
}

type CreateUserPasskey struct {
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
}

type UserPasskeyRepository interface {
	Repository

	userPasskeyColumns
	userPasskeyConditions
	userPasskeyChanges

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserPasskey, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*UserPasskey, error)
	Create(ctx context.Context, client database.QueryExecutor, passkey *CreateUserPasskey) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userPasskeyColumns interface {
	ProjectID() database.Column
	UserID() database.Column
	CredentialID() database.Column
	PublicKey() database.Column
	AAGUID() database.Column
	AttestationType() database.Column
	Transports() database.Column
	SignCount() database.Column
	BackupEligible() database.Column
	BackupState() database.Column
	Name() database.Column
	VerifiedAt() database.Column
	LastUsedAt() database.Column
	CreatedAt() database.Column
	UpdatedAt() database.Column
}

type userPasskeyConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	UserIDCondition(userID string) database.Condition
	CredentialIDCondition(credentialID string) database.Condition
	PrimaryKeyCondition(projectID, userID, credentialID string) database.Condition
}

type userPasskeyChanges interface {
	SetAttestationType(string) database.Change
	SetTransports([]string) database.Change
	IncrementSignCount(diff int64) database.Change
	SetBackupEligible(bool) database.Change
	SetBackupState(bool) database.Change
	SetVerifiedAt(time.Time) database.Change
	SetLastUsedAt(time.Time) database.Change
}
