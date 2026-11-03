package v4

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"fmt"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// MasterKeyLength is the length v4 requires of its master key (AES-256).
const MasterKeyLength = 32

// CryptoValue is v4's crypto.CryptoValue as event payloads store it. The v4
// type has no JSON tags, so its Go field names are the JSON keys.
type CryptoValue struct {
	CryptoType int
	Algorithm  string
	KeyID      string
	Crypted    []byte
}

// Keys are v4's encryption keys from system.encryption_keys, unwrapped with
// the master key.
type Keys struct {
	keys map[string][]byte
}

// LoadKeys reads every key of system.encryption_keys and unwraps it with the
// master key: each stored key is base64url(IV || AES-256-CFB(masterKey, key)).
// A wrong master key is not detected here, because CFB has no MAC; it shows
// when a value decrypts to something that is not text.
func (s *Source) LoadKeys(ctx context.Context, masterKey []byte) (*Keys, error) {
	if len(masterKey) != MasterKeyLength {
		return nil, fmt.Errorf("the v4 master key must be %d bytes, got %d", MasterKeyLength, len(masterKey))
	}
	keys := &Keys{keys: map[string][]byte{}}
	err := s.readTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id, key FROM system.encryption_keys`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id, wrapped string
			if err := rows.Scan(&id, &wrapped); err != nil {
				return err
			}
			key, err := unwrapKey(wrapped, masterKey)
			if err != nil {
				return fmt.Errorf("unwrap key %q: %w", id, err)
			}
			keys.keys[id] = key
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("read v4 encryption keys: %w", err)
	}
	return keys, nil
}

// unwrapKey is v4's crypto.DecryptAESString over a stored key.
func unwrapKey(wrapped string, masterKey []byte) ([]byte, error) {
	raw, err := base64.URLEncoding.DecodeString(wrapped)
	if err != nil {
		return nil, fmt.Errorf("not base64url: %w", err)
	}
	return decryptAES(raw, masterKey)
}

// DecryptString decrypts an AES CryptoValue the way v4's AESCrypto does,
// looking the key up by the id the value carries. It refuses a result that is
// not printable text: that is what a wrong master key produces.
func (k *Keys) DecryptString(v *CryptoValue) (string, error) {
	if v == nil {
		return "", errors.New("no encrypted value")
	}
	if v.Algorithm != "aes" {
		return "", fmt.Errorf("unsupported algorithm %q", v.Algorithm)
	}
	key, ok := k.keys[v.KeyID]
	if !ok {
		return "", fmt.Errorf("encryption key %q not found in system.encryption_keys", v.KeyID)
	}
	plain, err := decryptAES(v.Crypted, key)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(plain) || !printable(plain) {
		return "", errors.New("value does not decrypt to text: is the v4 master key correct?")
	}
	return string(plain), nil
}

func printable(b []byte) bool {
	for _, r := range string(b) {
		if !unicode.IsPrint(r) {
			return false
		}
	}
	return true
}

// decryptAES is v4's crypto.DecryptAES: the first block is the IV, the rest
// AES-CFB ciphertext.
func decryptAES(text, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(text) < aes.BlockSize {
		return nil, errors.New("cipher text block too short")
	}
	plain := make([]byte, len(text)-aes.BlockSize)
	cipher.NewCFBDecrypter(block, text[:aes.BlockSize]).XORKeyStream(plain, text[aes.BlockSize:]) //nolint:staticcheck // v4's format
	return plain, nil
}
