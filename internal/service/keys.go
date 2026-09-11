package service

import (
	"context"
	"errors"

	"github.com/go-jose/go-jose/v4"
	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/oidc/v3/pkg/op"
)

// ---- Interface -------------------------------------------------------------

type KeyService interface {
	SaveEncryptionKey(ctx context.Context, stmts AllStatements, key *domain.EncryptionKey) error
	GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error)
	GetCrypter(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Crypto, error)
	GetProjectEncryptionKey(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (*domain.EncryptionKey, error)
	GetProjectCrypter(ctx context.Context, projectID string, purpose domain.EncryptionKeyPurpose) (op.Crypto, error)
	SaveSigningKey(ctx context.Context, stmts AllStatements, key *domain.SigningKey) error
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
	Get(keyID string) (key domain.EncryptionKey, ok bool)
}

// SigningKeyCache caches encryption keys to reduce the load of on the database.
//
// Values in the cache are values, not pointers to ensure a copy is always
// returned and the value of the cache cannot be corrupted by accident.
type SigningKeyCache interface {
	Add(key domain.SigningKey) (evicted bool)
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

func (s *keyService) SaveEncryptionKey(ctx context.Context, stmts AllStatements, key *domain.EncryptionKey) error {
	if err := stmts.CreateEncryptionKey(ctx, key); err != nil {
		if mapped := mapStorageError(err); mapped != err {
			return mapped
		}
		return domain.ErrInternal(err).
			WithMessage("failed to create encryption key in the database").
			WithDetails(map[string]any{"purpose": key.Purpose})
	}
	return nil
}

func (s *keyService) GetEncryptionKey(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (*domain.EncryptionKey, error) {
	if key, ok := s.encryptionKeyCache.Get(keyID); ok && key.Algorithm == algorithm {
		return new(key), nil
	}

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

	s.encryptionKeyCache.Add(*key)
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

func (s *keyService) SaveSigningKey(ctx context.Context, stmts AllStatements, key *domain.SigningKey) error {
	if err := stmts.CreateSigningKey(ctx, key); err != nil {
		if mapped := mapStorageError(err); mapped != err {
			return mapped
		}
		return domain.ErrInternal(err).
			WithMessage("failed to create signing key in the database").
			WithDetails(map[string]any{"purpose": key.Purpose})
	}
	return nil
}

func (s *keyService) GetProjectSigningKey(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) (*domain.SigningKey, error) {
	if key, ok := s.signingKeyCache.Get(projectID, purpose); ok {
		return new(key), nil
	}

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

	s.signingKeyCache.Add(*key)
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

type LRUEncryptionKeyCache struct {
	cache *lru.Cache[string, domain.EncryptionKey]
}

func NewLRUEncryptionKeyCache(size int) (*LRUEncryptionKeyCache, error) {
	cache, err := lru.New[string, domain.EncryptionKey](size)
	if err != nil {
		return nil, err
	}
	return new(LRUEncryptionKeyCache{cache: cache}), nil
}

func (c LRUEncryptionKeyCache) Add(key domain.EncryptionKey) (evicted bool) {
	return c.cache.Add(key.ID, key)
}
func (c LRUEncryptionKeyCache) Get(keyID string) (key domain.EncryptionKey, ok bool) {
	return c.cache.Get(keyID)
}

type signingKeyCacheKey struct {
	projectID string
	purpose   domain.SigningKeyPurpose
}
type LRUSigningKeyCache struct {
	cache *lru.Cache[signingKeyCacheKey, domain.SigningKey]
}

func NewLRUSigningKeyCache(size int) (*LRUSigningKeyCache, error) {
	cache, err := lru.New[signingKeyCacheKey, domain.SigningKey](size)
	if err != nil {
		return nil, err
	}
	return new(LRUSigningKeyCache{cache: cache}), nil
}

func (c LRUSigningKeyCache) Add(key domain.SigningKey) (evicted bool) {
	return c.cache.Add(signingKeyCacheKey{
		projectID: key.ProjectID,
		purpose:   key.Purpose,
	}, key)
}
func (c LRUSigningKeyCache) Get(projectID string, purpose domain.SigningKeyPurpose) (key domain.SigningKey, ok bool) {
	return c.cache.Get(signingKeyCacheKey{
		projectID: projectID,
		purpose:   purpose,
	})
}
