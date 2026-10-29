package domain

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
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
	SigningKeyPurposeToken SigningKeyPurpose = "token"
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
	seed := make([]byte, ed25519.SeedSize)
	_, err := rand.Read(seed)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate new signing key")
	}

	encryptedKey, err := kek.Encrypt(string(seed))
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to encrypt signing key")
	}

	return &SigningKey{
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
	return k.SignerWithOptions(kek, nil)
}

// SignerWithOptions is Signer with the JOSE header options a token profile
// asks for, such as RFC 9068's `typ: at+jwt`.
func (k *SigningKey) SignerWithOptions(kek crypto.Crypter, opts *jose.SignerOptions) (jose.Signer, error) {
	private, err := k.PrivateKey(kek)
	if err != nil {
		return nil, err
	}
	return jose.NewSigner(
		jose.SigningKey{
			Algorithm: k.Algorithm,
			Key: &jose.JSONWebKey{
				Key:   private,
				KeyID: k.ID,
			},
		},
		opts,
	)
}

// PrivateKey unwraps the key's seed with kek.
func (k *SigningKey) PrivateKey(kek crypto.Crypter) (ed25519.PrivateKey, error) {
	decrypted, err := kek.Decrypt(k.Key)
	if err != nil {
		return nil, ErrDecryptionFailed(err)
	}
	if len(decrypted) != ed25519.SeedSize {
		return nil, ErrDecryptionFailed(nil).WithDetails(fmt.Sprintf("signing key seed is not %d bytes", ed25519.SeedSize))
	}
	return ed25519.NewKeyFromSeed([]byte(decrypted)), nil
}

// PublicJWK is the key as a JWKS publishes it: the public half, its id, its
// algorithm, and `use: sig`.
func (k *SigningKey) PublicJWK(kek crypto.Crypter) (jose.JSONWebKey, error) {
	private, err := k.PrivateKey(kek)
	if err != nil {
		return jose.JSONWebKey{}, err
	}
	return jose.JSONWebKey{
		Key:       private.Public(),
		KeyID:     k.ID,
		Algorithm: string(k.Algorithm),
		Use:       "sig",
	}, nil
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
