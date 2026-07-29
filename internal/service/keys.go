package service

import (
	"context"
	"errors"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
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
	MigrateToLatestRootKEK(ctx context.Context) error
}

// ---- Implementation -------------------------------------------------------------

type keyService struct {
	db   *DB
	keks domain.RootKEKs
}

func NewKeyService(
	db *DB,
	keks domain.RootKEKs,
) KeyService {
	return &keyService{
		db:   db,
		keks: keks,
	}
}

func (s *keyService) GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error) {
	key, err := s.db.Statements().GetEncryptionKey(ctx, database2.And(
		database2.Equal(database2.Col(domain.EncryptionKeyFieldID), keyID),
		database2.Equal(database2.Col(domain.EncryptionKeyFieldAlgorithm), algorithm),
	))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
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
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
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

	if kek := s.keks.GetByKeyID(jweHeader.KeyID); kek != nil {
		return key.Crypter(kek)
	}

	kek, err := s.GetCrypter(ctx, jweHeader.KeyID, jweHeader.EncryptionAlgorithm)
	if err != nil {
		return nil, err
	}
	return key.Crypter(kek)
}

func (s *keyService) GetKekCrypter(ctx context.Context) (op.Crypto, error) {
	return s.keks, nil
}

func (s *keyService) MigrateToLatestRootKEK(ctx context.Context) error {
	opts := &database2.ListOptions[domain.EncryptionKeyField]{
		Pagination: database2.Page[domain.EncryptionKeyField]{
			Limit: 100,
			OrderBy: database2.OrderBy[domain.EncryptionKeyField]{
				Columns: []database2.Column[domain.EncryptionKeyField]{
					database2.Col(domain.EncryptionKeyFieldID),
				},
			},
		},
	}

	keys, err := s.db.Statements().ListEncryptionKeys(ctx, opts)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to get keys from database")
	}

	var errs []error

	for key, err := range keys.Iterate(func(cursor []byte) (*database2.ListResult[*domain.EncryptionKey], error) {
		opts.Pagination.Cursor = cursor
		return s.db.Statements().ListEncryptionKeys(ctx, opts)
	}) {
		if err != nil {
			errs = append(errs, domain.ErrInternal(err).WithMessage("failed to list keys from database"))
			break
		}

		jweHeader, err := domain.DecodeJWEHeader(key.Key)
		if err != nil {
			errs = append(errs, domain.ErrInternal(err).
				WithMessage("failed to decode JWE header").
				WithDetails(map[string]any{"keyID": key.ID}))
			continue
		}

		kek := s.keks.GetByKeyID(jweHeader.KeyID)
		if kek == nil {
			// if no key is encrypted by another key than the kek, we don't need to migrate
			continue
		}

		if kek.ID == s.keks.EncryptionKey.ID {
			// if key already the latest kek, we don't need to migrate
			continue
		}

		if err = key.MigrateToNewKEK(kek, new(s.keks.EncryptionKey)); err != nil {
			errs = append(errs, domain.ErrInternal(err).
				WithMessage("failed to migrate key").
				WithDetails(map[string]any{"keyID": key.ID}))
			continue
		}

		if err = s.db.Statements().UpdateKey(ctx, key.ID, key.Key); err != nil {
			errs = append(errs, domain.ErrInternal(err).WithMessage("failed to save migrated key to the database"))
			continue
		}
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}
