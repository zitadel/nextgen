package service

import (
	"context"
	"errors"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/crypto"
	"github.com/zitadel/nextgen/internal/storage/database"
	database2 "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/oidc/v3/pkg/op"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/keys.mock.go . KeyService

// ---- Interface -------------------------------------------------------------

type KeyService interface {
	GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*crypto.EncryptionKey, error)
	GetCrypter(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Crypto, error)
	GetProjectDEK(ctx context.Context, projectID string) (*crypto.EncryptionKey, error)
	GetProjectDEKCrypter(ctx context.Context, projectID string) (op.Crypto, error)
}

// ---- Implementation -------------------------------------------------------------

type keyService struct {
	db  *DB
	kek op.Crypto
}

func NewKeyService(
	db *DB,
	kek op.Crypto,
) KeyService {
	return &keyService{
		db:  db,
		kek: kek,
	}
}

func (s *keyService) GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*crypto.EncryptionKey, error) {
	key, err := s.db.Statements().GetEncryptionKey(ctx, database2.And(
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldID), keyID),
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldAlgorithm), algorithm),
	))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, crypto.ErrEncryptionKeyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get DEK from the database")
	}
	return key, nil
}

// GetCrypter fetches the encryption key for the given ID from the database,
// decrypts it and creates an op.Crypto from it.
//
// If the encryption key to decrypt the requested key exists in the database,
// it is recursively fetched.
func (s *keyService) GetCrypter(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Crypto, error) {
	key, err := s.GetEncryptionKey(ctx, keyID, algorithm)
	if err != nil {
		return nil, err
	}
	kek, err := s.getKekCrypter(ctx, key)
	if err != nil {
		return nil, err
	}
	return key.Crypter(kek)
}

func (s *keyService) GetProjectDEK(ctx context.Context, projectID string) (*crypto.EncryptionKey, error) {
	dek, err := s.db.Statements().GetEncryptionKey(ctx, database2.And(
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldProjectID), projectID),
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldState), crypto.KeyStateActive),
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldPurpose), crypto.EncryptionKeyPurposeDEK),
	))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, crypto.ErrEncryptionKeyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get DEK from the database")
	}
	return dek, nil
}

func (s *keyService) GetProjectDEKCrypter(ctx context.Context, projectID string) (op.Crypto, error) {
	dek, err := s.GetProjectDEK(ctx, projectID)
	if err != nil {
		return nil, err
	}
	kek, err := s.getKekCrypter(ctx, dek)
	if err != nil {
		return nil, err
	}
	return dek.Crypter(kek)
}

func (s *keyService) getKekCrypter(ctx context.Context, key *crypto.EncryptionKey) (op.Crypto, error) {
	jweHeader, err := domain.DecodeJWEHeader(key.Key)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode decryption key")
	}

	// TODO match the key id with the key id from one fo the keks once they are implemented
	if jweHeader.KeyID == "" && jweHeader.EncryptionAlgorithm == jose.A256GCM {
		return s.kek, nil
	}

	kek, err := s.GetCrypter(ctx, jweHeader.KeyID, jweHeader.EncryptionAlgorithm)
	if err != nil {
		return nil, err
	}
	return key.Crypter(kek)
}
