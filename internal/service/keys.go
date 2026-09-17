package service

import (
	"context"
	"errors"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/cache"
	"github.com/zitadel/nextgen/internal/crypto"
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

// ---- Implementation -------------------------------------------------------------

type keyService struct {
	db              *DB
	masterKeys      domain.MasterKeys
	crypterCache    cache.Cache[CrypterCacheKey, op.Crypto]
	signingKeyCache cache.Cache[SigningKeyCacheKey, domain.SigningKey]
}

func NewKeyService(
	db *DB,
	masterKeys domain.MasterKeys,
	crypterCache cache.Cache[CrypterCacheKey, op.Crypto],
	signingKeyCache cache.Cache[SigningKeyCacheKey, domain.SigningKey],
) KeyService {
	return &keyService{
		db:              db,
		masterKeys:      masterKeys,
		crypterCache:    crypterCache,
		signingKeyCache: signingKeyCache,
	}
}

type CrypterCacheKey struct {
	KeyID     string
	Algorithm jose.ContentEncryption
}

type SigningKeyCacheKey struct {
	ProjectID string
	Purpose   domain.SigningKeyPurpose
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

// GetCrypter returns the crypter for the given key id, reading the key and
// unwrapping it only on a cache miss.
//
// This is the per-request path: every authenticated request decrypts its bearer
// credential through here, so a hit has to cost neither a read nor an unwrap.
func (s *keyService) GetCrypter(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Crypto, error) {
	if crypter, ok := s.crypterCache.Get(CrypterCacheKey{KeyID: keyID, Algorithm: algorithm}); ok {
		return crypter, nil
	}

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
	if crypter, ok := s.crypterCache.Get(CrypterCacheKey{KeyID: key.ID, Algorithm: key.Algorithm}); ok {
		return crypter, nil
	}
	return s.getCrypterOfKey(ctx, key)
}

// getCrypterOfKey unwraps key and caches the result. It deliberately does not
// consult the cache: every caller has already looked this key up and missed, so
// a second lookup here would record a second miss for one request -- and a
// fourth for a key wrapped by a project KEK, which resolves through here twice.
// The hit rate this cache exists to report would understate itself.
func (s *keyService) getCrypterOfKey(ctx context.Context, key *domain.EncryptionKey) (op.Crypto, error) {
	jweHeader, err := domain.DecodeJWEHeader(key.Key)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode decryption key")
	}

	// A key wrapped directly by a master key carries that master key's ID; every
	// other key is wrapped by the project KEK and resolved recursively.
	//
	// Both arms resolve the wrapping key and then fall through to the one unwrap
	// and the one Add below. Returning early from either would leave that key
	// uncached, and the master key arm is the expensive one -- unwrapping under
	// it is the RSA private-key operation this cache exists to avoid.
	var kek crypto.Crypter
	if masterKey := s.masterKeys.GetByKeyID(jweHeader.KeyID); masterKey != nil {
		kek = masterKey
	} else {
		// A database read and a recursion, both of which the cache above spares
		// every caller after the first.
		resolved, err := s.GetCrypter(ctx, jweHeader.KeyID, jweHeader.EncryptionAlgorithm)
		if err != nil {
			return nil, err
		}
		kek = resolved
	}

	crypter, err := key.Crypter(kek)
	if err != nil {
		return nil, err
	}

	s.crypterCache.Add(CrypterCacheKey{KeyID: key.ID, Algorithm: key.Algorithm}, crypter)
	return crypter, nil
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
	if key, ok := s.signingKeyCache.Get(SigningKeyCacheKey{ProjectID: projectID, Purpose: purpose}); ok {
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

	s.signingKeyCache.Add(SigningKeyCacheKey{ProjectID: projectID, Purpose: purpose}, *key)
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
