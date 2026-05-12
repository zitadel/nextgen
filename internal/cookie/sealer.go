// Package cookie provides a sealed-token primitive for cookies that must
// survive an untrusted client roundtrip — encrypted, authenticated, and
// stamped with an issued-at timestamp for max-age enforcement.
package cookie

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// KeySize is the required length of a [Key] in bytes (AES-256).
const KeySize = 32

// Sealer wire layout (after base64url-decode):
//
//	version (1) || nonce (gcmNonceSize) || ciphertext+tag
//
// The plaintext inside ciphertext is `issuedAt (8) || payload`. The
// version byte is authenticated as AAD, so swapping it invalidates the
// GCM tag.
const (
	gcmNonceSize = 12
	gcmTagSize   = 16
	issuedAtSize = 8 // int64 unix nanoseconds, big-endian
)

// ErrInvalid is returned by [Sealer.Open] for any format or integrity
// failure: bad base64, short input, unknown version byte, tag mismatch.
var ErrInvalid = errors.New("cookie: integrity check failed")

// ErrExpired is returned by [Sealer.Open] when the issued-at timestamp
// is outside the sealer's max-age window.
var ErrExpired = errors.New("cookie: expired")

// Key is a versioned AES-256 secret. The Version byte is the leading
// byte of every value the key seals; Open uses it to route between the
// current and previous keys during rotation.
type Key struct {
	Version byte
	Bytes   [KeySize]byte
}

// Sealer encrypts and authenticates byte payloads for use in HTTP
// cookies. It is safe for concurrent use.
type Sealer struct {
	current  Key
	previous *Key
	maxAge   time.Duration
	now      func() time.Time
}

// NewSealer returns a Sealer that seals with current and opens against
// current OR previous (when non-nil) to support zero-downtime rotation.
// maxAge bounds how long a sealed value remains valid; it must be > 0.
func NewSealer(current Key, previous *Key, maxAge time.Duration) (*Sealer, error) {
	if maxAge <= 0 {
		return nil, errors.New("cookie: max-age must be positive")
	}
	if previous != nil && previous.Version == current.Version {
		return nil, errors.New("cookie: previous key must have a different version byte than current")
	}
	return &Sealer{
		current:  current,
		previous: previous,
		maxAge:   maxAge,
		now:      time.Now,
	}, nil
}

// Seal stamps the current time, encrypts the payload, and returns the
// base64url-encoded cookie value.
func (s *Sealer) Seal(payload []byte) (string, error) {
	aead, err := newAEAD(s.current.Bytes[:])
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcmNonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("cookie: read nonce: %w", err)
	}

	plaintext := make([]byte, issuedAtSize+len(payload))
	binary.BigEndian.PutUint64(plaintext[:issuedAtSize], uint64(s.now().UnixNano()))
	copy(plaintext[issuedAtSize:], payload)

	ciphertext := aead.Seal(nil, nonce, plaintext, []byte{s.current.Version})

	buf := make([]byte, 0, 1+len(nonce)+len(ciphertext))
	buf = append(buf, s.current.Version)
	buf = append(buf, nonce...)
	buf = append(buf, ciphertext...)
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// Open reverses Seal. It returns [ErrInvalid] for any format or
// integrity failure and [ErrExpired] when the issued-at timestamp is
// outside the sealer's max-age window.
func (s *Sealer) Open(value string) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrInvalid
	}
	if len(raw) < 1+gcmNonceSize+gcmTagSize+issuedAtSize {
		return nil, ErrInvalid
	}

	version := raw[0]
	key, ok := s.keyForVersion(version)
	if !ok {
		return nil, ErrInvalid
	}

	aead, err := newAEAD(key[:])
	if err != nil {
		return nil, ErrInvalid
	}
	nonce := raw[1 : 1+gcmNonceSize]
	ciphertext := raw[1+gcmNonceSize:]
	plaintext, err := aead.Open(nil, nonce, ciphertext, []byte{version})
	if err != nil {
		return nil, ErrInvalid
	}
	if len(plaintext) < issuedAtSize {
		return nil, ErrInvalid
	}

	issuedAt := time.Unix(0, int64(binary.BigEndian.Uint64(plaintext[:issuedAtSize])))
	if s.now().Sub(issuedAt) > s.maxAge {
		return nil, ErrExpired
	}
	return plaintext[issuedAtSize:], nil
}

func (s *Sealer) keyForVersion(version byte) ([KeySize]byte, bool) {
	if version == s.current.Version {
		return s.current.Bytes, true
	}
	if s.previous != nil && version == s.previous.Version {
		return s.previous.Bytes, true
	}
	return [KeySize]byte{}, false
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
