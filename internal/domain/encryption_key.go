package domain

import (
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/oidc/v3/pkg/op"
)

const (
	PrefixEncryptionKey ResourcePrefix = "enc_key"
)

func ErrSupportedEncryptionAlgorithm(alg jose.ContentEncryption) Error {
	return newError(PrefixEncryptionKey.ErrorCodePrefix("unknown_alg"), "unsupported encryption algorithm", map[string]any{"algorithm": alg}, nil)
}

func ErrNoReplacementKey() Error {
	return newError(PrefixEncryptionKey.ErrorCodePrefix("no_replacement_key"), "no replacement key was provided while retiring the current one", nil, nil)
}

func ErrEncryptionKeyNotFound() Error {
	return newError(PrefixEncryptionKey.ErrorCodePrefix("not_found"), "encryption key not found", nil, nil)
}

func ErrEncryptionFailed(parent error) Error {
	return newError(PrefixEncryptionKey.ErrorCodePrefix("encrypt_failed"), "failed to encrypt data", nil, parent)
}
func ErrDecryptionFailed(parent error) Error {
	return newError(PrefixEncryptionKey.ErrorCodePrefix("decrypt_failed"), "failed to decrypt data", nil, parent)
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
	// EncryptionKeyPurposeKEK indicates the key is the project's key encryption
	// key which is used to encrypt the purpose-scoped keys of the project. It is
	// itself encrypted by the master key.
	EncryptionKeyPurposeKEK EncryptionKeyPurpose = "kek"
	// EncryptionKeyPurposeToken indicates the key is used to encrypt tokens
	EncryptionKeyPurposeToken EncryptionKeyPurpose = "token"
	// EncryptionKeyPurposeSecret indicates the key is used to encrypt
	// third-party secrets like client-secrets, passwords,... for third party
	// applications
	EncryptionKeyPurposeSecret EncryptionKeyPurpose = "secret"
	// EncryptionKeyPurposeCookie indicates the key is used to encrypt cookies
	EncryptionKeyPurposeCookie EncryptionKeyPurpose = "cookie"
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

func NewEncryptionKey(
	projectID string,
	purpose EncryptionKeyPurpose,
	algorithm jose.ContentEncryption,
	kek crypto.Crypter,
) (*EncryptionKey, error) {
	var key [32]byte
	_, err := rand.Read(key[:])
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate new encryption key")
	}

	encryptedKey, err := kek.Encrypt(string(key[:]))
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to encrypt the new encryption key")
	}

	// createdAt is set by db
	return &EncryptionKey{
		ProjectID: projectID,
		Key:       encryptedKey,
		Algorithm: algorithm,
		State:     KeyStateNotActiveYet,
		Purpose:   purpose,
	}, nil
}

func (k *EncryptionKey) Activate(currentKey *EncryptionKey) {
	now := time.Now().UTC()
	if currentKey != nil {
		currentKey.State = KeyStateExpired
		currentKey.RetiredAt = new(now)
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

// MigrateToNewMasterKey re-wraps the key material under newMasterKey without
// changing the key itself, so nothing encrypted by this key has to be touched.
func (k *EncryptionKey) MigrateToNewMasterKey(oldMasterKey crypto.Crypter, newMasterKey crypto.Crypter) error {
	decrypted, err := oldMasterKey.Decrypt(k.Key)
	if err != nil {
		return ErrDecryptionFailed(err)
	}

	encrypted, err := newMasterKey.Encrypt(decrypted)
	if err != nil {
		return ErrEncryptionFailed(err)
	}

	k.Key = encrypted
	return nil
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
	EncryptionKeyFieldUnspecified EncryptionKeyField = iota
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

type MasterKey struct {
	ID                        string
	key                       rsa.PrivateKey
	ShouldBeUsedForEncryption bool
}

func NewMasterKey(
	id string,
	key rsa.PrivateKey,
	shouldBeUsedForEncryption bool,
) MasterKey {
	return MasterKey{
		ID:                        id,
		key:                       key,
		ShouldBeUsedForEncryption: shouldBeUsedForEncryption,
	}
}

// masterKeyAlgorithm and masterKeyContentEncryption are the JWE algorithms used
// to wrap keys with a master key. RSA-OAEP-256 fixes the OAEP hash to SHA-256.
const (
	masterKeyAlgorithm         = jose.RSA_OAEP_256
	masterKeyContentEncryption = jose.A256GCM
)

// Encrypt wraps decrypted with the master key and returns a JWE compact
// serialization. The JWE protected header carries the master key's ID as "kid"
// so the key can later be resolved without trying every configured master key.
func (k *MasterKey) Encrypt(decrypted string) (string, error) {
	encrypter, err := jose.NewEncrypter(
		masterKeyContentEncryption,
		jose.Recipient{
			Algorithm: masterKeyAlgorithm,
			Key:       &k.key.PublicKey,
			KeyID:     k.ID,
		},
		nil,
	)
	if err != nil {
		return "", ErrEncryptionFailed(err)
	}

	jwe, err := encrypter.Encrypt([]byte(decrypted))
	if err != nil {
		return "", ErrEncryptionFailed(err)
	}

	serialized, err := jwe.CompactSerialize()
	if err != nil {
		return "", ErrEncryptionFailed(err)
	}
	return serialized, nil
}

func (k *MasterKey) Decrypt(encrypted string) (string, error) {
	jwe, err := jose.ParseEncrypted(
		encrypted,
		[]jose.KeyAlgorithm{masterKeyAlgorithm},
		[]jose.ContentEncryption{masterKeyContentEncryption},
	)
	if err != nil {
		return "", ErrDecryptionFailed(err)
	}

	decrypted, err := jwe.Decrypt(&k.key)
	if err != nil {
		return "", ErrDecryptionFailed(err)
	}
	return string(decrypted), nil
}

type MasterKeys struct {
	Keys          []MasterKey
	EncryptionKey MasterKey
}

func NewMasterKeys(keys []MasterKey) (*MasterKeys, error) {
	var encryptionKey *MasterKey
	switch len(keys) {
	case 0:
		return nil, ErrRequestInvalid().WithMessage("no root encryption key provided")
	case 1:
		encryptionKey = new(keys[0])
		keys = nil
	default:
		for i, k := range keys {
			if k.ShouldBeUsedForEncryption {
				if encryptionKey != nil {
					return nil, ErrRequestInvalid().WithMessage("only one key can be marked for encryption")
				}
				encryptionKey = new(k)
				keys[i] = keys[len(keys)-1]
				keys = keys[:len(keys)-1]
			}
		}
	}

	if encryptionKey == nil {
		return nil, ErrRequestInvalid().WithMessage("no key is marked for encryption")
	}

	return &MasterKeys{
		Keys:          keys,
		EncryptionKey: *encryptionKey,
	}, nil
}

func (ks MasterKeys) Encrypt(decrypted string) (string, error) {
	return ks.EncryptionKey.Encrypt(decrypted)
}

func (ks MasterKeys) Decrypt(encrypted string) (string, error) {
	header, err := DecodeJWEHeader(encrypted)
	if err != nil {
		return "", ErrDecryptionFailed(err).WithDetails("failed to decode JWE header")
	}

	kek := ks.GetByKeyID(header.KeyID)
	if kek == nil {
		return "", ErrDecryptionFailed(errors.New("no key found to decrypt key")).
			WithDetails(map[string]any{"keyID": header.KeyID})
	}

	return kek.Decrypt(encrypted)
}

func (ks MasterKeys) GetByKeyID(id string) *MasterKey {
	if ks.EncryptionKey.ID == id {
		return new(ks.EncryptionKey)
	}

	for _, kek := range ks.Keys {
		if id == kek.ID {
			return new(kek)
		}
	}

	return nil
}
