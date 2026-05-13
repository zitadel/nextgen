package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
)

type KeyManager struct {
	keys              map[uint32][]byte
	activeFingerprint uint32
}

func (km *KeyManager) Encrypt(plaintext []byte) ([]byte, error) {
	key, ok := km.keys[km.activeFingerprint]
	if !ok {
		return nil, fmt.Errorf("active key version %d not found", km.activeFingerprint)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return nil, err
	}
	// We prefix the 4-byte fingerprint to the result
	prefix := make([]byte, 4)
	binary.BigEndian.PutUint32(prefix, km.activeFingerprint)

	return gcm.Seal(prefix, nil, plaintext, nil), nil
}

func (km *KeyManager) Decrypt(data []byte) ([]byte, error) {
	if len(data) < 16 { // 4 (FP) + 12 (Nonce)
		return nil, errors.New("invalid ciphertext")
	}

	// extract fingerprint
	fp := binary.BigEndian.Uint32(data[:4])
	key, ok := km.keys[fp]
	if !ok {
		return nil, fmt.Errorf("unknown key fingerprint: %x", fp)
	}

	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCMWithRandomNonce(block)

	// decrypt with the ciphertext starting after the fingerprint
	return gcm.Open(nil, nil, data[4:], nil)
}

func NewKeyManager(activeKey []byte, oldKeys ...[]byte) *KeyManager {
	km := &KeyManager{keys: make(map[uint32][]byte)}

	// Register the active key
	activeFP := fingerprint(activeKey)
	km.keys[activeFP] = activeKey
	km.activeFingerprint = activeFP

	// Register old keys
	for _, k := range oldKeys {
		km.keys[fingerprint(k)] = k
	}
	return km
}

// fingerprint generates a 4-byte identifier for a key
func fingerprint(key []byte) uint32 {
	h := sha256.Sum256(key)
	return binary.BigEndian.Uint32(h[:4])
}
