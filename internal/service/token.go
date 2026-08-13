package service

import (
	"context"
	"errors"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Interface -------------------------------------------------------------

type TokenService interface {
	GenerateJWE(ctx context.Context, data *domain.Token) (string, error)
	RevokeToken(ctx context.Context, projectID, tokenID string) error
	IntrospectToken(ctx context.Context, token string) (*domain.Token, error)
	GetActivePreviewToken(ctx context.Context, projectID string) (*domain.Token, error)
}

// ---- Implementation -------------------------------------------------------------

type tokenService struct {
	keys   KeyService
	v2Pool StatementPool
}

func NewTokenService(
	keys KeyService,
	v2Pool StatementPool,
) TokenService {
	return &tokenService{
		keys:   keys,
		v2Pool: v2Pool,
	}
}

func (s *tokenService) GenerateJWE(ctx context.Context, data *domain.Token) (string, error) {
	if err := s.v2Pool.Statements().CreateToken(ctx, data); err != nil {
		return "", domain.ErrInternal(err).WithMessage("failed to persist token record")
	}
	tokenCrypter, err := s.keys.GetProjectCrypter(ctx, data.ProjectID, domain.EncryptionKeyPurposeToken)
	if err != nil {
		return "", err
	}
	return data.JWE(tokenCrypter)
}

func (s *tokenService) GetActivePreviewToken(ctx context.Context, projectID string) (*domain.Token, error) {
	opts := &database.ListOptions[domain.TokenField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
			database.Equal(database.Col(domain.TokenFieldType), domain.TokenTypeProjectPreview.String()),
		),
		Pagination: database.Page[domain.TokenField]{
			Limit: 100,
			OrderBy: database.OrderBy[domain.TokenField]{
				// token_id breaks ties so the page is deterministic.
				Columns: []database.Column[domain.TokenField]{
					database.Col(domain.TokenFieldCreatedAt),
					database.Col(domain.TokenFieldTokenID),
				},
			},
		},
	}
	result, err := s.v2Pool.Statements().ListTokens(ctx, opts)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get token")
	}
	now := time.Now()
	for token, err := range result.Iterate(func(cursor []byte) (*database.ListResult[*domain.Token], error) {
		opts.Pagination.Cursor = cursor
		return s.v2Pool.Statements().ListTokens(ctx, opts)
	}) {
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to get token")
		}

		if token.Active(now) {
			return token, nil
		}
	}
	return nil, domain.TokenNotFound()
}

func (s *tokenService) RevokeToken(ctx context.Context, projectID, tokenID string) error {
	if tokenID == "" {
		return nil
	}
	if err := s.v2Pool.Statements().DeleteTokenByID(ctx, projectID, tokenID); err != nil {
		return domain.ErrInternal(err).WithMessage("failed to revoke token")
	}
	return nil
}

func (s *tokenService) IntrospectToken(ctx context.Context, token string) (*domain.Token, error) {
	payload, err := domain.ParseAndValidateToken(ctx, token,
		func(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Decrypter, error) {
			return s.keys.GetCrypter(ctx, keyID, algorithm)
		},
	)
	if err != nil {
		return nil, err
	}
	if !payload.IsRevocable() {
		return payload, nil
	}
	// Credentials minted before token records existed carry no `jti`. They stay
	// authentic — a token cannot be forged without the encryption key — so they
	// keep working, unrevocable, until they are reissued.
	if payload.TokenID == "" {
		return payload, nil
	}

	record, err := s.v2Pool.Statements().GetTokenByID(ctx, payload.ProjectID, payload.TokenID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrTokenRevoked()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read token record")
	}
	if !record.Active(time.Now()) {
		return nil, domain.ErrTokenRevoked()
	}

	return payload, nil
}
