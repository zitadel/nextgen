package service

import (
	"context"

	"github.com/go-jose/go-jose/v4"
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
}

func NewTokenService(
	keys KeyService,
) TokenService {
	return &tokenService{
		keys: keys,
	}
}

func (s *tokenService) GenerateJWE(ctx context.Context, data *domain.Token) (string, error) {
	tokenCrypter, err := s.keys.GetProjectCrypter(ctx, data.ProjectID, domain.EncryptionKeyPurposeToken)
	if err != nil {
		return "", err
	}
	return data.JWE(tokenCrypter)
}

func (s *tokenService) VerifyToken(ctx context.Context, token string) (*domain.Token, error) {
	return domain.ParseAndValidateToken(ctx, token,
		func(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Decrypter, error) {
			return s.keys.GetCrypter(ctx, keyID, algorithm)
		},
	)
}
