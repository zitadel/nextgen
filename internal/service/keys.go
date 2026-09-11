package service

import (
	"context"
	"errors"
	"sync"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/oidc/v3/pkg/op"
)

// ---- Interface -------------------------------------------------------------

type KeyService interface {
	SaveEncryptionKey(ctx context.Context, key *domain.EncryptionKey) error
	GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error)
	GetCrypter(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Crypto, error)
	GetProjectEncryptionKey(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (*domain.EncryptionKey, error)
	GetProjectCrypter(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (op.Crypto, error)
	SaveSigningKey(ctx context.Context, key *domain.SigningKey) error
	GetProjectSigningKey(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (*domain.SigningKey, error)
	GetProjectSigner(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (jose.Signer, error)
	GetMasterKeyCrypter(ctx context.Context) (op.Crypto, error)
	MigrateToLatestMasterKey(ctx context.Context) error
}

// EncryptionKeyCache caches encryption keys to reduce the load of on the database.
//
// Values in the cache are values, not pointers to ensure a copy is always
// returned and the value of the cache cannot be corrupted by accident.
type EncryptionKeyCache interface {
	Add(key domain.EncryptionKey) (evicted bool)
	Remove(keyID string) (present bool)
	Get(keyID string) (key domain.EncryptionKey, ok bool)
}

// SigningKeyCache caches encryption keys to reduce the load of on the database.
//
// Values in the cache are values, not pointers to ensure a copy is always
// returned and the value of the cache cannot be corrupted by accident.
type SigningKeyCache interface {
	Add(key domain.SigningKey) (evicted bool)
	Remove(projectID string, purpose domain.SigningKeyPurpose) (present bool)
	Get(projectID string, purpose domain.SigningKeyPurpose) (key domain.SigningKey, ok bool)
}

// ---- Implementation -------------------------------------------------------------

type keyService struct {
	db                 *DB
	masterKeys         domain.MasterKeys
	encryptionKeyCache EncryptionKeyCache
	signingKeyCache    SigningKeyCache
}

func NewKeyService(
	db *DB,
	masterKeys domain.MasterKeys,
	encryptionKeyCache EncryptionKeyCache,
	signingKeyCache SigningKeyCache,
) KeyService {
	return &keyService{
		db:                 db,
		masterKeys:         masterKeys,
		encryptionKeyCache: encryptionKeyCache,
		signingKeyCache:    signingKeyCache,
	}
}

// ------------------------------------------------------
// ENCRYPTION KEYS
// ------------------------------------------------------

func (s *keyService) SaveEncryptionKey(ctx context.Context, key *domain.EncryptionKey) error {
	err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateEncryptionKey(ctx, key); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create encryption key in the database")
		}
		s.encryptionKeyCache.Add(*key)
		return nil
	})

	if err != nil {
		err = mapStorageError(err)
		if _, ok := errors.AsType[domain.Error](err); ok {
			return err
		}
		return domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return nil
}

func (s *keyService) GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error) {
	if key, ok := s.encryptionKeyCache.Get(keyID); ok && key.Algorithm == algorithm {
		return new(key), nil
	}

	var key *domain.EncryptionKey
	err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var err error
		key, err = tx.Statements().GetEncryptionKey(ctx, database.And(
			database.Equal(database.Col(domain.EncryptionKeyFieldID), keyID),
			database.Equal(database.Col(domain.EncryptionKeyFieldAlgorithm), algorithm),
		))
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrEncryptionKeyNotFound()
			}
			return domain.ErrInternal(err).WithMessage("failed to get encryption key from the database")
		}
		s.encryptionKeyCache.Add(*key)
		return nil
	})

	if err != nil {
		err = mapStorageError(err)
		if _, ok := errors.AsType[domain.Error](err); ok {
			return nil, err
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
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

// ------------------------------------------------------
// SIGNING KEYS
// ------------------------------------------------------

func (s *keyService) SaveSigningKey(ctx context.Context, key *domain.SigningKey) error {
	err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateSigningKey(ctx, key); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create encryption key in the database")
		}
		s.signingKeyCache.Add(*key)
		return nil
	})

	if err != nil {
		err = mapStorageError(err)
		if _, ok := errors.AsType[domain.Error](err); ok {
			return err
		}
		return domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return nil
}

func (s *keyService) GetProjectSigningKey(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (*domain.SigningKey, error) {
	if key, ok := s.signingKeyCache.Get(projectID, purpose); ok {
		return new(key), nil
	}

	var key *domain.SigningKey
	err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var err error
		key, err = tx.Statements().GetSigningKey(ctx, database.And(
			database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID),
			database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateActive),
			database.Equal(database.Col(domain.SigningKeyFieldPurpose), purpose),
		))
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrSigningKeyNotFound()
			}
			return domain.ErrInternal(err).WithMessage("failed to get signing key from the database")
		}
		s.signingKeyCache.Add(*key)
		return nil
	})

	if err != nil {
		err = mapStorageError(err)
		if _, ok := errors.AsType[domain.Error](err); ok {
			return nil, err
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
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

// ------------------------------------------------------
// MASTER KEYS
// ------------------------------------------------------

var masterKeyMigrationLock sync.Mutex

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
	var keyUpdates []*domain.EncryptionKey

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

		keyUpdates = append(keyUpdates, key)

		// to ensure the key updates does not grow out of control, paginate it by 100
		if len(keyUpdates) < 100 {
			continue
		}
		err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
			for _, updated := range keyUpdates {
				if err = s.db.Statements().UpdateKey(ctx, updated.ID, updated.Key); err != nil {
					errs = append(errs, domain.ErrInternal(err).WithMessage("failed to save migrated key to the database"))
					continue
				}
				s.encryptionKeyCache.Add(*updated)
			}
			return nil
		})
		if err != nil {
			errs = append(errs, domain.ErrInternal(err).WithMessage("failed to commit transaction"))
		}
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}
