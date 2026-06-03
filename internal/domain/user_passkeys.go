package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserPasskey struct {
	ID              int64
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

	userPasskeyConditions
	userPasskeyChanges

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserPasskey, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*UserPasskey, error)
	Create(ctx context.Context, client database.QueryExecutor, passkey *CreateUserPasskey) error
	Update(ctx context.Context, client database.QueryExecutor, condition database.Condition, changes ...database.Change) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userPasskeyConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	UserIDCondition(userID string) database.Condition
	CredentialIDCondition(credentialID string) database.Condition
	PrimaryKeyCondition(id int64) database.Condition
	UniqueCondition(projectID, userID, credentialID string) database.Condition
}

type userPasskeyChanges interface {
	SetAttestationType(string) database.Change
	SetTransports([]string) database.Change
	SetSignCount(int64) database.Change
	IncrementSignCount(diff int64) database.Change
	SetBackupEligible(bool) database.Change
	SetBackupState(bool) database.Change
	SetVerifiedAt(time.Time) database.Change
	SetLastUsedAt(time.Time) database.Change
}
