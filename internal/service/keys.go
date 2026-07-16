package service

import (
	"context"
	"errors"

	crypto2 "github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/crypto"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type RotateDEKInput struct {
	ProjectID string
}

type GetProjectDEKInput struct {
	ProjectID string
}

// ---- Implementation -------------------------------------------------------------

type KeyService struct {
	db  *DB
	kek crypto2.Crypter
}

func NewKeyService(
	db *DB,
	kek crypto2.Crypter,
) *KeyService {
	return &KeyService{
		db:  db,
		kek: kek,
	}
}

func (s *KeyService) RotateDEK(ctx context.Context, input RotateDEKInput) error {
	err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		oldDEK, err := tx.Statements().GetActiveDEK(ctx, input.ProjectID)
		if err != nil {
			// not found errors might occur if no DEK exists, don't error on that
			// just create a new one.
			if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
				return domain.ErrInternal(err).WithMessage("failed to get current DEK from the database")
			}
		}

		newDEK, err := crypto.NewDEK(input.ProjectID, crypto.DEKAlgorithmAESGCM, s.kek)
		if err != nil {
			return err
		}
		newDEK.Activate(oldDEK)

		err = tx.Statements().CreateDEK(ctx, newDEK)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create DEK")
		}

		err = tx.Statements().UpdateDEK(ctx, oldDEK)
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

func (s *KeyService) GetProjectDEK(ctx context.Context, input GetProjectDEKInput) (*crypto.DEK, error) {
	dek, err := s.db.Statements().GetActiveDEK(ctx, input.ProjectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, crypto.ErrDEKNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get DEK from the database")
	}
	return dek, nil
}

func (s *KeyService) GetProjectDEKCrypter(ctx context.Context, input GetProjectDEKInput) (crypto2.Crypter, error) {
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

type DEKCrypterCreator struct {
	keys *KeyService
}

func NewDEKCrypterCreator(
	keys *KeyService,
) *DEKCrypterCreator {
	return &DEKCrypterCreator{
		keys: keys,
	}
}

func (c *DEKCrypterCreator) Crypter(ctx context.Context, projectID string) (crypto2.Crypter, error) {
	return c.keys.GetProjectDEKCrypter(ctx, GetProjectDEKInput{ProjectID: projectID})
}
