package spanner

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain/crypto"
	"github.com/zitadel/nextgen/internal/service"
)

type cryptoKeyStatements struct{ statement }

// CreateDEK implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) CreateDEK(ctx context.Context, dek *crypto.DEK) error {
	panic("unimplemented")
}

// UpdateDEK implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) UpdateDEK(ctx context.Context, dek *crypto.DEK) error {
	panic("unimplemented")
}

// GetActiveDEK implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) GetActiveDEK(ctx context.Context, projectID string) (*crypto.DEK, error) {
	panic("unimplemented")
}

// IsStatements implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) IsStatements() {}

func newCryptoKeyStatements(client queryExecutor) cryptoKeyStatements {
	return cryptoKeyStatements{
		statement: statement{
			client: client,
		},
	}
}

var _ service.CryptoKeyStatements = (*cryptoKeyStatements)(nil)
