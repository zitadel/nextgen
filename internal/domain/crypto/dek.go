package crypto

import (
	"crypto/rand"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/oidc/v3/pkg/op"
)

const (
	PrefixDEK domain.ResourcePrefix = "dek"
)

type KeyState string

const (
	KeyStateNotActiveYet KeyState = "not_active_yet"
	KeyStateActive                = "active"
	KeyStateExpired               = "expired"
	KeyStateRemoved               = "removed"
)

type DEKAlgorithm string

const (
	DEKAlgorithmAESGCM DEKAlgorithm = "AES-GCM"
)

func ErrUnknownDEKAlgorithm(alg DEKAlgorithm) domain.Error {
	return domain.NewError(PrefixDEK.ErrorCodePrefix("unknown_alg"), "unknown DEK encryption algorithm", map[string]any{"algorithm": alg}, nil)
}

func ErrNoReplacementDEK() domain.Error {
	return domain.NewError(PrefixDEK.ErrorCodePrefix("no_replacement_key"), "no replacement key was provided while retiring the current one", nil, nil)
}

func ErrDEKNotFound() domain.Error {
	return domain.NewError(PrefixDEK.ErrorCodePrefix("not_found"), "dek not found", nil, nil)
}

func ErrDecryptionFailed(parent error) domain.Error {
	return domain.NewError(PrefixDEK.ErrorCodePrefix("decrypt_failed"), "failed to decrypt key", nil, parent)
}

type DEK struct {
	Id          string
	ProjectID   string
	Key         []byte
	Algorithm   DEKAlgorithm
	State       KeyState
	CreatedAt   time.Time
	ActivatedAt *time.Time
	RetiredAt   *time.Time
}

func NewDEK(projectID string, algorithm DEKAlgorithm, kek crypto.Crypter) (*DEK, error) {
	id, err := domain.NewID(PrefixDEK)
	if err != nil {
		return nil, err
	}

	var key [32]byte
	_, err = rand.Read(key[:])
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to generate new DEK key")
	}

	encryptedKey, err := kek.Encrypt(string(key[:]))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encrypt dek")
	}

	// createdAt is set by db
	return &DEK{
		Id:        id,
		ProjectID: projectID,
		Key:       []byte(encryptedKey),
		Algorithm: algorithm,
		State:     KeyStateNotActiveYet,
	}, nil
}

func (k *DEK) Activate(currentDEK *DEK) {
	now := time.Now().UTC()
	if currentDEK != nil {
		currentDEK.State = KeyStateExpired
		currentDEK.RetiredAt = new(now)
	}
	k.State = KeyStateActive
	k.ActivatedAt = new(now)
}

func (k *DEK) Expire(replacement *DEK) error {
	if replacement == nil {
		return ErrNoReplacementDEK()
	}
	now := new(time.Now().UTC())
	replacement.State = KeyStateExpired
	replacement.RetiredAt = now
	k.State = KeyStateActive
	k.ActivatedAt = now
	return nil
}

func (k *DEK) Remove(replacement *DEK) error {
	if replacement == nil {
		return ErrNoReplacementDEK()
	}
	now := new(time.Now().UTC())
	replacement.State = KeyStateRemoved
	replacement.RetiredAt = now
	k.State = KeyStateActive
	k.ActivatedAt = now
	return nil
}

func (k *DEK) IsActive() bool {
	return k.State == KeyStateActive
}

func (k *DEK) DecryptedKey(kek crypto.Decrypter) ([32]byte, error) {
	decrypted, err := kek.Decrypt(string(k.Key))
	if err != nil {
		return [32]byte{}, ErrDecryptionFailed(err)
	}

	return [32]byte([]byte(decrypted)), nil
}

func (k *DEK) Crypter(kek crypto.Crypter) (crypto.Crypter, error) {
	key, err := k.DecryptedKey(kek)
	if err != nil {
		return nil, err
	}
	switch k.Algorithm {
	case DEKAlgorithmAESGCM:
		return op.NewAES256GCMCrypto(key, k.Id), nil
	default:
		return nil, ErrUnknownDEKAlgorithm(k.Algorithm)
	}
}

type DEKField uint8

const (
	DEKFieldUnspecified DEKField = iota
	DEKFieldID
	DEKFieldProjectID
	DEKFieldKey
	DEKFieldAlgorithm
	DEKFieldState
	DEKFieldCreatedAt
	DEKFieldActivatedAt
	DEKFieldRetiredAt
)
