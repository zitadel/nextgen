// Package cookie seals byte payloads into encrypted, tamper-evident
// strings safe to put in an HTTP cookie. The client can't read or
// modify what's inside, and every value carries its own timestamp so
// the server can reject anything older than a configured max-age.
//
// Use NewSealer to build one with a key and a max-age. Call Seal to
// turn a payload into a cookie value, and Open to get the payload
// back. Open tells you via ErrInvalid or ErrExpired when a value
// shouldn't be trusted.
//
// Under the hood the format is JWE with AES-256-GCM. We only accept
// that one combination on the way in — anything else gets rejected as
// invalid.
package cookie

import (
	"encoding/binary"
	"errors"
	"fmt"
	"time"

	"github.com/go-jose/go-jose/v4"
)

// KeySize is how many bytes a Key must be.
const KeySize = 32

// We prepend this many bytes to every payload to record when it was
// sealed, so Open can decide whether the value is still fresh.
const issuedAtSize = 8

// ErrInvalid means the sealed value can't be trusted — it's in the
// wrong shape, was encrypted with something we don't accept, or
// someone tampered with it.
var ErrInvalid = errors.New("cookie: integrity check failed")

// ErrExpired means the sealed value was once valid but has aged out
// past the sealer's max-age.
var ErrExpired = errors.New("cookie: expired")

var (
	allowedKeyAlgorithms      = []jose.KeyAlgorithm{jose.DIRECT}
	allowedContentEncryptions = []jose.ContentEncryption{jose.A256GCM}
)

// Key is the secret a sealer uses to lock and unlock cookie values.
// It must be exactly KeySize bytes.
type Key [KeySize]byte

// Sealer turns byte payloads into sealed cookie values and back.
// It's safe to share across goroutines.
type Sealer struct {
	key       Key
	maxAge    time.Duration
	now       func() time.Time
	encrypter jose.Encrypter
}

// NewSealer builds a Sealer with the given key and max-age. Values
// older than max-age won't open. max-age must be positive.
func NewSealer(key Key, maxAge time.Duration) (*Sealer, error) {
	if maxAge <= 0 {
		return nil, errors.New("cookie: max-age must be positive")
	}

	encrypter, err := jose.NewEncrypter(
		jose.A256GCM,
		jose.Recipient{
			Algorithm: jose.DIRECT,
			Key:       key[:],
		},
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("cookie: build encrypter: %w", err)
	}

	return &Sealer{
		key:       key,
		maxAge:    maxAge,
		now:       time.Now,
		encrypter: encrypter,
	}, nil
}

// Seal stamps the current time onto payload, encrypts the result,
// and returns a single string ready to drop into a cookie.
func (s *Sealer) Seal(payload []byte) (string, error) {
	plaintext := make([]byte, issuedAtSize+len(payload))
	binary.BigEndian.PutUint64(plaintext[:issuedAtSize], uint64(s.now().UnixNano()))
	copy(plaintext[issuedAtSize:], payload)

	obj, err := s.encrypter.Encrypt(plaintext)
	if err != nil {
		return "", fmt.Errorf("cookie: encrypt: %w", err)
	}
	out, err := obj.CompactSerialize()
	if err != nil {
		return "", fmt.Errorf("cookie: serialize: %w", err)
	}
	return out, nil
}

// Open reverses Seal and returns the original payload. It returns
// ErrInvalid when the value can't be trusted (wrong format, wrong
// key, tampered with) and ErrExpired when it's older than the
// sealer's max-age.
func (s *Sealer) Open(value string) ([]byte, error) {
	obj, err := jose.ParseEncrypted(value, allowedKeyAlgorithms, allowedContentEncryptions)
	if err != nil {
		return nil, ErrInvalid
	}
	plaintext, err := obj.Decrypt(s.key[:])
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
