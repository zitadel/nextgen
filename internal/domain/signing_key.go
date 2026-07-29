package domain

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/crypto"
)

const (
	PrefixSigningKey ResourcePrefix = "sig_key"
)

func ErrSigningKeyNotFound() Error {
	return newError(PrefixSigningKey.ErrorCodePrefix("not_found"), "signing key not found", nil, nil)
}

type SigningKeyPurpose string

const (
	SigningKeyPurposeToken = "token"
)

type SigningKey struct {
	ID          string
	ProjectID   string
	Purpose     SigningKeyPurpose
	Key         string
	Algorithm   jose.SignatureAlgorithm
	State       KeyState
	CreatedAt   time.Time
	ActivatedAt *time.Time
	RetiredAt   *time.Time
}

func NewSigningKey(
	projectID string,
	purpose SigningKeyPurpose,
	algorithm jose.SignatureAlgorithm,
	kek crypto.Crypter,
) (*SigningKey, error) {
	id, err := newID(PrefixSigningKey)
	if err != nil {
		return nil, err
	}

	seed := make([]byte, ed25519.SeedSize)
	_, err = rand.Read(seed)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate new signing key")
	}

	encryptedKey, err := kek.Encrypt(string(seed))
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to encrypt signing key")
	}

	// createdAt is set by db
	return &SigningKey{
		ID:        id,
		ProjectID: projectID,
		Key:       encryptedKey,
		Algorithm: algorithm,
		State:     KeyStateNotActiveYet,
		Purpose:   purpose,
	}, nil
}

func (k *SigningKey) Activate(currentKey *SigningKey) {
	now := time.Now().UTC()
	if currentKey != nil {
		currentKey.State = KeyStateExpired
		currentKey.RetiredAt = new(now)
	}
	k.State = KeyStateActive
	k.ActivatedAt = new(now)
}

func (k *SigningKey) IsActive() bool {
	return k.State == KeyStateActive
}
func (k *SigningKey) IsRemoved() bool {
	return k.State == KeyStateRemoved
}

func (k *SigningKey) Signer(kek crypto.Crypter) (jose.Signer, error) {
	decrypted, err := kek.Decrypt(k.Key)
	if err != nil {
		return nil, ErrDecryptionFailed(err)
	}
	return jose.NewSigner(
		jose.SigningKey{
			Algorithm: k.Algorithm,
			Key: &jose.JSONWebKey{
				Key:   []byte(decrypted),
				KeyID: k.ID,
			},
		},
		nil,
	)
}

type SigningKeyField uint8

const (
	SigningKeyFieldUnspecified SigningKeyField = iota
	SigningKeyFieldID
	SigningKeyFieldProjectID
	SigningKeyFieldKey
	SigningKeyFieldAlgorithm
	SigningKeyFieldState
	SigningKeyFieldCreatedAt
	SigningKeyFieldActivatedAt
	SigningKeyFieldRetiredAt
	SigningKeyFieldPurpose
)
