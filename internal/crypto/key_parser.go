package crypto

import (
	"crypto/rsa"
	"errors"
	"fmt"

	"github.com/go-jose/go-jose/v4"
	"golang.org/x/crypto/ssh"
)

func ParseRSAKey(s string) (*rsa.PrivateKey, error) {
	key, pemErr := ParsePrivatePEMKey(s)
	if pemErr == nil {
		return key, nil
	}

	key, jwkErr := ParsePrivateJWK(s)
	if jwkErr == nil {
		return key, nil
	}

	return nil, fmt.Errorf("failed to parse private key: %w", errors.Join(pemErr, jwkErr))
}

func ParsePrivatePEMKey(s string) (*rsa.PrivateKey, error) {
	key, err := ssh.ParseRawPrivateKey([]byte(s))
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	rsakey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("key is not an RSA private key; only RSA keys are supported")
	}

	return rsakey, nil
}

func ParsePrivateJWK(s string) (*rsa.PrivateKey, error) {
	var jwk jose.JSONWebKey
	if err := jwk.UnmarshalJSON([]byte(s)); err != nil {
		return nil, fmt.Errorf("failed to parse JWK: %w", err)
	}

	rsakey, ok := jwk.Key.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("key is no rsa key. only rsa keys are supported")
	}

	return rsakey, nil
}
