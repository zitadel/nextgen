package repository

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	_ "embed"
	"encoding/pem"

	"github.com/fxamacker/cbor/v2"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	//go:embed publickey.pem
	publicKey []byte
)

type UserPasskeyRepository struct{}

func (u *UserPasskeyRepository) Get(ctx context.Context, q database.QueryExecutor, projectID, userID, passkeyID string) (*domain.UserPasskey, error) {
	pub, err := newKey(publicKey)
	if err != nil {
		return nil, err
	}
	return &domain.UserPasskey{
		KeyID:                        []byte("test-passkey-id"),
		PublicKey:                    pub,
		AttestationType:              "",
		AuthenticatorAttestationGUID: nil,
		SignCount:                    0,
	}, nil
}

func (u *UserPasskeyRepository) List(ctx context.Context, q database.QueryExecutor, projectID, userID string) ([]*domain.UserPasskey, error) {
	pub, err := newKey(publicKey)
	if err != nil {
		return nil, err
	}
	return []*domain.UserPasskey{
		{
			KeyID:                        []byte("test-passkey-id"),
			PublicKey:                    pub,
			AttestationType:              "",
			AuthenticatorAttestationGUID: nil,
			SignCount:                    0,
		},
	}, nil
}

func newKey(data []byte) ([]byte, error) {
	block, _ := pem.Decode(data)
	publicKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey := publicKey.(*rsa.PublicKey)
	info := webauthncose.RSAPublicKeyData{
		PublicKeyData: webauthncose.PublicKeyData{
			KeyType:   int64(webauthncose.RSAKey),
			Algorithm: int64(webauthncose.AlgRS256),
		},
		Modulus:  rsaKey.N.Bytes(),
		Exponent: bigEndianBytes(rsaKey.E, 3),
	}
	return marshalCbor(info)
}

func bigEndianBytes[T interface{ int | uint32 }](value T, length int) []byte {
	bytes := make([]byte, length)
	for i := 0; i < length; i++ {
		shift := (length - i - 1) * 8
		bytes[i] = byte(value >> shift & 0xFF)
	}
	return bytes
}

func marshalCbor(v any) ([]byte, error) {
	encoder, err := cbor.CTAP2EncOptions().EncMode()
	if err != nil {
		return nil, err
	}
	bytes, err := encoder.Marshal(v)
	if err != nil {
		return nil, err
	}
	return bytes, nil
}
