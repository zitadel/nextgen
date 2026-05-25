// Package cookie seals byte payloads into encrypted, tamper-evident
// strings safe to put in an HTTP cookie. The client can't read or
// modify what's inside.
//
// Use NewSealer to build one with a key. Call Seal to turn a payload
// into a cookie value, and Open to get the payload back. Open returns
// ErrInvalid when a value can't be trusted. Freshness (max-age) is
// the caller's concern: stamp the payload with a timestamp and reject
// stale values after Open.
//
// Under the hood the format is JWE with AES-256-GCM. We only accept
// that one combination on the way in — anything else gets rejected as
// invalid.
package cookie

import (
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/go-jose/go-jose/v4"
)

// KeySize is how many bytes a Key must be.
const KeySize = 32

// ErrInvalid means the sealed value can't be trusted — it's in the
// wrong shape, was encrypted with something we don't accept, or
// someone tampered with it.
var ErrInvalid = errors.New("cookie: integrity check failed")

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
	encrypter jose.Encrypter
}

// NewSealerFromHex builds a Sealer from a hex-encoded key. The decoded
// key must be exactly KeySize bytes; anything else is a configuration
// error.
func NewSealerFromHex(hexKey string) (*Sealer, error) {
	if hexKey == "" {
		return nil, errors.New("cookie: hex key is empty")
	}
	raw, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("cookie: decode hex key: %w", err)
	}
	if len(raw) != KeySize {
		return nil, fmt.Errorf("cookie: hex key must decode to %d bytes, got %d", KeySize, len(raw))
	}
	var key Key
	copy(key[:], raw)
	return NewSealer(key)
}

// NewSealer builds a Sealer with the given key.
func NewSealer(key Key) (*Sealer, error) {
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
		encrypter: encrypter,
	}, nil
}

// Seal encrypts payload and returns a single string ready to drop
// into a cookie.
func (s *Sealer) Seal(payload []byte) (string, error) {
	obj, err := s.encrypter.Encrypt(payload)
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
// key, tampered with).
func (s *Sealer) Open(value string) ([]byte, error) {
	obj, err := jose.ParseEncrypted(value, allowedKeyAlgorithms, allowedContentEncryptions)
	if err != nil {
		return nil, ErrInvalid
	}
	plaintext, err := obj.Decrypt(s.key[:])
	if err != nil {
		return nil, ErrInvalid
	}
	return plaintext, nil
}
