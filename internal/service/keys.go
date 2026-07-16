package service

import (
	"context"
	"errors"

	"github.com/go-jose/go-jose/v4"
	crypto2 "github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/crypto"
	"github.com/zitadel/nextgen/internal/storage/database"
	database2 "github.com/zitadel/nextgen/internal/storage/v2/database"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/keys.mock.go . KeyService

// ---- Interface -------------------------------------------------------------

type KeyService interface {
	RotateDEK(ctx context.Context, input RotateDEKInput) error
	GetEncryptionKeyByID(ctx context.Context, input GetDEKByIDAndAlgorithmInput) (*crypto.EncryptionKey, error)
	GetProjectDEK(ctx context.Context, input GetProjectDEKInput) (*crypto.EncryptionKey, error)
	GetProjectDEKCrypter(ctx context.Context, input GetProjectDEKInput) (crypto2.Crypter, error)
}

// ---- Input types -------------------------------------------------------------

type RotateDEKInput struct {
	ProjectID string
}

type GetProjectDEKInput struct {
	ProjectID string
}

type GetDEKByIDAndAlgorithmInput struct {
	KeyID     string
	Algorithm jose.ContentEncryption
}

// ---- Implementation -------------------------------------------------------------

type keyService struct {
	db  *DB
	kek crypto2.Crypter
}

func NewKeyService(
	db *DB,
	kek crypto2.Crypter,
) KeyService {
	return &keyService{
		db:  db,
		kek: kek,
	}
}

func (s *keyService) RotateDEK(ctx context.Context, input RotateDEKInput) error {
	err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		oldDEK, err := s.GetProjectDEK(ctx, GetProjectDEKInput{ProjectID: input.ProjectID})
		if err != nil {
			// not found errors might occur if no DEK exists, don't error on that
			// just create a new one.
			if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
				return domain.ErrInternal(err).WithMessage("failed to get current DEK from the database")
			}
		}

		newDEK, err := crypto.NewDEK(input.ProjectID, jose.A256GCM, s.kek)
		if err != nil {
			return err
		}
		newDEK.Activate(oldDEK)

		err = tx.Statements().CreateEncryptionKey(ctx, newDEK)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create DEK")
		}

		err = tx.Statements().UpdateEncryptionKey(ctx, oldDEK)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to expire DEK")
		}

		return nil
	})

	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}
	return nil
}

func (s *keyService) GetEncryptionKeyByID(ctx context.Context, input GetDEKByIDAndAlgorithmInput) (*crypto.EncryptionKey, error) {
	dek, err := s.db.Statements().GetEncryptionKey(ctx, database2.And(
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldID), input.KeyID),
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldAlgorithm), input.Algorithm),
	))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, crypto.ErrEncryptionKeyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get DEK from the database")
	}
	return dek, nil
}

func (s *keyService) GetProjectDEK(ctx context.Context, input GetProjectDEKInput) (*crypto.EncryptionKey, error) {
	dek, err := s.db.Statements().GetEncryptionKey(ctx, database2.And(
		database2.Equal(database2.Col(crypto.EncryptionKeyFieldProjectID), input.ProjectID),
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

func (s *keyService) GetProjectDEKCrypter(ctx context.Context, input GetProjectDEKInput) (crypto2.Crypter, error) {
	dek, err := s.GetProjectDEK(ctx, input)
	if err != nil {
		return nil, err
	}
	crypter, err := dek.Crypter(s.kek)
	if err != nil {
		return nil, err
	}
	return crypter, nil
}
