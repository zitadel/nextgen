package service

import (
	"context"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/oidc/v3/pkg/op"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/token.mock.go . TokenService

// ---- Interface -------------------------------------------------------------

type TokenService interface {
	GenerateJWE(ctx context.Context, data *domain.Token) (string, error)
	VerifyToken(ctx context.Context, token string) (*domain.Token, error)
}

// ---- Implementation -------------------------------------------------------------

type tokenService struct {
	keys KeyService
	kek  crypto.Crypter
}

func NewTokenService(
	keys KeyService,
	kek crypto.Crypter,
) TokenService {
	return &tokenService{
		keys: keys,
		kek:  kek,
	}
}

func (s *tokenService) GenerateJWE(ctx context.Context, data *domain.Token) (string, error) {
	dek, err := s.keys.GetProjectDEKCrypter(ctx, GetProjectDEKInput{data.ProjectID})
	if err != nil {
		return "", err
	}
	return data.JWE(dek)
}

func (s *tokenService) VerifyToken(ctx context.Context, token string) (*domain.Token, error) {
	return domain.ParseAndValidateToken(ctx, token,
		func(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Decrypter, error) {
			dek, err := s.keys.GetEncryptionKeyByID(ctx, GetDEKByIDAndAlgorithmInput{KeyID: keyID, Algorithm: algorithm})
			if err != nil {
				return nil, err
			}
			return dek.Crypter(s.kek)
		},
	)
}
