package service

import (
	"context"
	"errors"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/domain"
	database2 "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/oidc/v3/pkg/op"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/keys.mock.go . KeyService

// ---- Interface -------------------------------------------------------------

type KeyService interface {
	GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error)
	GetCrypter(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Crypto, error)
	GetProjectDEK(ctx context.Context, projectID string) (*domain.EncryptionKey, error)
	GetProjectDEKCrypter(ctx context.Context, projectID string) (op.Crypto, error)
	GetKekCrypter(ctx context.Context) (op.Crypto, error)
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

func (s *keyService) GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error) {
	key, err := s.db.Statements().GetEncryptionKey(ctx, database2.And(
		database2.Equal(database2.Col(domain.EncryptionKeyFieldID), keyID),
		database2.Equal(database2.Col(domain.EncryptionKeyFieldAlgorithm), algorithm),
	))
	if err != nil {
		if _, ok := errors.AsType[*database2.NoRowFoundError](err); ok {
			return nil, domain.ErrEncryptionKeyNotFound()
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
	return s.getCrypterOfKey(ctx, key)
}

func (s *keyService) GetProjectDEK(ctx context.Context, projectID string) (*domain.EncryptionKey, error) {
	dek, err := s.db.Statements().GetEncryptionKey(ctx, database2.And(
		database2.Equal(database2.Col(domain.EncryptionKeyFieldProjectID), projectID),
		database2.Equal(database2.Col(domain.EncryptionKeyFieldState), domain.KeyStateActive),
		database2.Equal(database2.Col(domain.EncryptionKeyFieldPurpose), domain.EncryptionKeyPurposeDEK),
	))
	if err != nil {
		if _, ok := errors.AsType[*database2.NoRowFoundError](err); ok {
			return nil, domain.ErrEncryptionKeyNotFound()
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
	return s.getCrypterOfKey(ctx, dek)
}

func (s *keyService) getCrypterOfKey(ctx context.Context, key *domain.EncryptionKey) (op.Crypto, error) {
	jweHeader, err := domain.DecodeJWEHeader(key.Key)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode decryption key")
	}

	// TODO match the key id with the key id from one of the keks once they are implemented
	if jweHeader.KeyID == "" && jweHeader.EncryptionAlgorithm == jose.A256GCM {
		return key.Crypter(s.kek)
	}

	kek, err := s.GetCrypter(ctx, jweHeader.KeyID, jweHeader.EncryptionAlgorithm)
	if err != nil {
		return nil, err
	}
	return key.Crypter(kek)
}

func (s *keyService) GetKekCrypter(ctx context.Context) (op.Crypto, error) {
	return s.kek, nil
}
