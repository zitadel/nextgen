package domain

import (
	stdcrypto "crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"fmt"
	"slices"
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

// SigningAlgorithms are the algorithms a project signs with, one active key
// each (ADR 082 §7): EdDSA, minted with the project; RS256, which OpenID
// Connect Discovery requires for ID tokens and every JWT library verifies; and
// ES256, which an app or an API may choose.
var SigningAlgorithms = []jose.SignatureAlgorithm{jose.EdDSA, jose.RS256, jose.ES256}

// rsaSigningKeyBits is an RS256 key's size, the minimum RFC 7518 §3.3 allows.
const rsaSigningKeyBits = 2048

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

// NewSigningKey generates a key of the algorithm and wraps it with kek: an
// EdDSA key as its 32-byte seed, an RS256 or ES256 key as PKCS #8.
func NewSigningKey(
	projectID string,
	purpose SigningKeyPurpose,
	algorithm jose.SignatureAlgorithm,
	kek crypto.Crypter,
) (*SigningKey, error) {
	material, err := newKeyMaterial(algorithm)
	if err != nil {
		return nil, err
	}

	encryptedKey, err := kek.Encrypt(string(material))
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

// newKeyMaterial generates the private key an algorithm signs with, encoded
// as the key column keeps it.
func newKeyMaterial(algorithm jose.SignatureAlgorithm) ([]byte, error) {
	var private any
	switch algorithm {
	case jose.EdDSA:
		seed := make([]byte, ed25519.SeedSize)
		if _, err := rand.Read(seed); err != nil {
			return nil, ErrInternal(err).WithMessage("failed to generate new signing key")
		}
		return seed, nil
	case jose.RS256:
		key, err := rsa.GenerateKey(rand.Reader, rsaSigningKeyBits)
		if err != nil {
			return nil, ErrInternal(err).WithMessage("failed to generate new signing key")
		}
		private = key
	case jose.ES256:
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, ErrInternal(err).WithMessage("failed to generate new signing key")
		}
		private = key
	default:
		return nil, ErrInternal(nil).WithMessage(fmt.Sprintf("no signing key for algorithm %q", algorithm))
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to encode signing key")
	}
	return der, nil
}

// PrivateKey unwraps the key with kek: an EdDSA key's seed, or an RS256 or
// ES256 key's PKCS #8, held to the key's algorithm.
func (k *SigningKey) PrivateKey(kek crypto.Crypter) (stdcrypto.Signer, error) {
	decrypted, err := kek.Decrypt(k.Key)
	if err != nil {
		return nil, ErrDecryptionFailed(err)
	}
	if k.Algorithm == jose.EdDSA {
		if len(decrypted) != ed25519.SeedSize {
			return nil, ErrDecryptionFailed(nil).WithDetails(fmt.Sprintf("signing key seed is not %d bytes", ed25519.SeedSize))
		}
		return ed25519.NewKeyFromSeed([]byte(decrypted)), nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey([]byte(decrypted))
	if err != nil {
		return nil, ErrDecryptionFailed(err)
	}
	switch key := parsed.(type) {
	case *rsa.PrivateKey:
		if k.Algorithm == jose.RS256 {
			return key, nil
		}
	case *ecdsa.PrivateKey:
		if k.Algorithm == jose.ES256 && key.Curve == elliptic.P256() {
			return key, nil
		}
	}
	return nil, ErrDecryptionFailed(nil).WithDetails(fmt.Sprintf("signing key is no %s key", k.Algorithm))
}

// SupportsSigningAlgorithm reports whether a project signs with algorithm.
func SupportsSigningAlgorithm(algorithm jose.SignatureAlgorithm) bool {
	return slices.Contains(SigningAlgorithms, algorithm)
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
