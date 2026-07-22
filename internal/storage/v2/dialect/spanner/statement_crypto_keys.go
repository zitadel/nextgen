package spanner

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type cryptoKeyStatements struct{ statement }

// CreateEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) CreateEncryptionKey(ctx context.Context, key *domain.EncryptionKey) error {
	panic("not implemented")
}

// GetEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) GetEncryptionKey(ctx context.Context, filter database.Filter[domain.EncryptionKeyField]) (*domain.EncryptionKey, error) {
	panic("not implemented")
}

// IsStatements implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) IsStatements() {}

func newCryptoKeyStatements(db queryExecutor) cryptoKeyStatements {
	return cryptoKeyStatements{
		statement: statement{
			db: db,
		},
	}
}

var _ service.CryptoKeyStatements = (*cryptoKeyStatements)(nil)
