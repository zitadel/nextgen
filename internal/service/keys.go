package service

import (
	"context"
	"errors"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/oidc/v3/pkg/op"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/keys.mock.go . KeyService

// ---- Interface -------------------------------------------------------------

type KeyService interface {
	GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error)
	GetCrypter(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Crypto, error)
	GetProjectEncryptionKey(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (*domain.EncryptionKey, error)
	GetProjectCrypter(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (op.Crypto, error)
	GetProjectSigningKey(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (*domain.SigningKey, error)
	GetProjectSigner(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (jose.Signer, error)
	GetMasterKeyCrypter(ctx context.Context) (op.Crypto, error)
	MigrateToLatestMasterKey(ctx context.Context) error
}

// ---- Implementation -------------------------------------------------------------

type keyService struct {
	db         *DB
	masterKeys domain.MasterKeys
}

func NewKeyService(
	db *DB,
	masterKeys domain.MasterKeys,
) KeyService {
	return &keyService{
		db:         db,
		masterKeys: masterKeys,
	}
}

func (s *keyService) GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error) {
	key, err := s.db.Statements().GetEncryptionKey(ctx, database.And(
		database.Equal(database.Col(domain.EncryptionKeyFieldID), keyID),
		database.Equal(database.Col(domain.EncryptionKeyFieldAlgorithm), algorithm),
	))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrEncryptionKeyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get encryption key from the database")
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

func (s *keyService) GetProjectEncryptionKey(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (*domain.EncryptionKey, error) {
	key, err := s.db.Statements().GetEncryptionKey(ctx, database.And(
		database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.EncryptionKeyFieldState), domain.KeyStateActive),
		database.Equal(database.Col(domain.EncryptionKeyFieldPurpose), purpose),
	))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrEncryptionKeyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get encryption key from the database")
	}
	return key, nil
}

func (s *keyService) GetProjectCrypter(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (op.Crypto, error) {
	key, err := s.GetProjectEncryptionKey(ctx, projectID, purpose)
	if err != nil {
		return nil, err
	}
	return s.getCrypterOfKey(ctx, key)
}

func (s *keyService) getCrypterOfKey(ctx context.Context, key *domain.EncryptionKey) (op.Crypto, error) {
	jweHeader, err := domain.DecodeJWEHeader(key.Key)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode decryption key")
	}

	// A key wrapped directly by a master key carries that master key's ID; every
	// other key is wrapped by the project KEK and resolved recursively below.
	if masterKey := s.masterKeys.GetByKeyID(jweHeader.KeyID); masterKey != nil {
		return key.Crypter(masterKey)
	}

	// This call does a database call to fetch the key with the given id and
	// recurses. This can be a performance hit. Maybe caching or a better
	// database query is required in the future?
	kek, err := s.GetCrypter(ctx, jweHeader.KeyID, jweHeader.EncryptionAlgorithm)
	if err != nil {
		return nil, err
	}
	return key.Crypter(kek)
}

func (s *keyService) GetProjectSigningKey(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (*domain.SigningKey, error) {
	key, err := s.db.Statements().GetSigningKey(ctx, database.And(
		database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateActive),
		database.Equal(database.Col(domain.SigningKeyFieldPurpose), purpose),
	))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrSigningKeyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get signing key from the database")
	}
	return key, nil
}

func (s *keyService) GetProjectSigner(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (jose.Signer, error) {
	key, err := s.GetProjectSigningKey(ctx, projectID, purpose)
	if err != nil {
		return nil, err
	}
	jweHeader, err := domain.DecodeJWEHeader(key.Key)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode signing key")
	}

	kek, err := s.GetCrypter(ctx, jweHeader.KeyID, jweHeader.EncryptionAlgorithm)
	if err != nil {
		return nil, err
	}
	return key.Signer(kek)
}

func (s *keyService) GetMasterKeyCrypter(context.Context) (op.Crypto, error) {
	return s.masterKeys, nil
}

func (s *keyService) MigrateToLatestMasterKey(ctx context.Context) error {
	opts := &database.ListOptions[domain.EncryptionKeyField]{
		Pagination: database.Page[domain.EncryptionKeyField]{
			Limit: 100,
			OrderBy: database.OrderBy[domain.EncryptionKeyField]{
				Columns: []database.Column[domain.EncryptionKeyField]{
					database.Col(domain.EncryptionKeyFieldID),
				},
			},
		},
	}

	keys, err := s.db.Statements().ListEncryptionKeys(ctx, opts)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to get keys from database")
	}

	var errs []error

	for key, err := range keys.Iterate(func(cursor []byte) (*database.ListResult[*domain.EncryptionKey], error) {
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

		masterKey := s.masterKeys.GetByKeyID(jweHeader.KeyID)
		if masterKey == nil {
			// the key is wrapped by a project KEK rather than a master key, so
			// master key rotation does not touch it
			continue
		}

		if masterKey.ID == s.masterKeys.EncryptionKey.ID {
			// already wrapped by the latest master key, nothing to migrate
			continue
		}

		if err = key.MigrateToNewMasterKey(masterKey, new(s.masterKeys.EncryptionKey)); err != nil {
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
