package domain

import (
	"crypto/rand"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/oidc/v3/pkg/op"
)

const (
	PrefixDEK ResourcePrefix = "dek"
)

func ErrSupportedEncryptionAlgorithm(alg jose.ContentEncryption) Error {
	return newError(PrefixDEK.ErrorCodePrefix("unknown_alg"), "unsupported encryption algorithm", map[string]any{"algorithm": alg}, nil)
}

func ErrNoReplacementKey() Error {
	return newError(PrefixDEK.ErrorCodePrefix("no_replacement_key"), "no replacement key was provided while retiring the current one", nil, nil)
}

func ErrEncryptionKeyNotFound() Error {
	return newError(PrefixDEK.ErrorCodePrefix("not_found"), "encryption key not found", nil, nil)
}

func ErrDecryptionFailed(parent error) Error {
	return newError(PrefixDEK.ErrorCodePrefix("decrypt_failed"), "failed to decrypt key", nil, parent)
}

type KeyState string

const (
	KeyStateNotActiveYet KeyState = "not_active_yet"
	KeyStateActive       KeyState = "active"
	KeyStateExpired      KeyState = "expired"
	KeyStateRemoved      KeyState = "removed"
)

type EncryptionKeyPurpose string

const (
	EncryptionKeyPurposeDEK EncryptionKeyPurpose = "dek"
)

type EncryptionKey struct {
	ID          string
	ProjectID   string
	Purpose     EncryptionKeyPurpose
	Key         string
	Algorithm   jose.ContentEncryption
	State       KeyState
	CreatedAt   time.Time
	ActivatedAt *time.Time
	RetiredAt   *time.Time
}

func NewDEK(projectID string, algorithm jose.ContentEncryption, kek crypto.Crypter) (*EncryptionKey, error) {
	id, err := newID(PrefixDEK)
	if err != nil {
		return nil, err
	}

	var key [32]byte
	_, err = rand.Read(key[:])
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate new DEK key")
	}

	encryptedKey, err := kek.Encrypt(string(key[:]))
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to encrypt dek")
	}

	// createdAt is set by db
	return &EncryptionKey{
		ID:        id,
		ProjectID: projectID,
		Key:       encryptedKey,
		Algorithm: algorithm,
		State:     KeyStateNotActiveYet,
		Purpose:   EncryptionKeyPurposeDEK,
	}, nil
}

func (k *EncryptionKey) Activate(currentDEK *EncryptionKey) {
	now := time.Now().UTC()
	if currentDEK != nil {
		currentDEK.State = KeyStateExpired
		currentDEK.RetiredAt = new(now)
	}
	k.State = KeyStateActive
	k.ActivatedAt = new(now)
}

func (k *EncryptionKey) IsActive() bool {
	return k.State == KeyStateActive
}
func (k *EncryptionKey) IsRemoved() bool {
	return k.State == KeyStateRemoved
}

func (k *EncryptionKey) DecryptedKey(kek crypto.Decrypter) ([32]byte, error) {
	decrypted, err := kek.Decrypt(k.Key)
	if err != nil {
		return [32]byte{}, ErrDecryptionFailed(err)
	}

	decryptedBs := []byte(decrypted)
	if len(decryptedBs) != 32 {
		return [32]byte{}, ErrDecryptionFailed(err).WithDetails("key length is not 32 bytes")
	}
	return [32]byte(decryptedBs), nil
}

func (k *EncryptionKey) Crypter(kek crypto.Crypter) (crypto.Crypter, error) {
	key, err := k.DecryptedKey(kek)
	if err != nil {
		return nil, err
	}
	switch k.Algorithm {
	case jose.A256GCM:
		return op.NewAES256GCMCrypto(key, k.ID), nil
	default:
		return nil, ErrSupportedEncryptionAlgorithm(k.Algorithm)
	}
}

type EncryptionKeyField uint8

const (
	DEKFieldUnspecified EncryptionKeyField = iota
	EncryptionKeyFieldID
	EncryptionKeyFieldProjectID
	EncryptionKeyFieldKey
	EncryptionKeyFieldAlgorithm
	EncryptionKeyFieldState
	EncryptionKeyFieldCreatedAt
	EncryptionKeyFieldActivatedAt
	EncryptionKeyFieldRetiredAt
	EncryptionKeyFieldPurpose
)
