package crypto

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
)

func ParsePrivatePEMKey(s string) (*rsa.PrivateKey, error) {
	pemDecoded, _ := pem.Decode([]byte(s))

	{
		key, err := x509.ParsePKCS1PrivateKey(pemDecoded.Bytes)
		if err == nil {
			return key, nil
		}
	}

	key, err := x509.ParsePKCS8PrivateKey(pemDecoded.Bytes)
	if err == nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	rsakey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("key is no rsa key. only rsa keys are supported")
	}

	return rsakey, nil
}
