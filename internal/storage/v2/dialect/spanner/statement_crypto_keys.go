package spanner

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain/crypto"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type cryptoKeyStatements struct{ statement }

// CreateEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) CreateEncryptionKey(ctx context.Context, dek *crypto.EncryptionKey) error {
	panic("not implemented")
}

// UpdateEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) UpdateEncryptionKey(ctx context.Context, dek *crypto.EncryptionKey) error {
	panic("not implemented")
}

// GetEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) GetEncryptionKey(ctx context.Context, filter database.Filter[crypto.EncryptionKeyField]) (*crypto.EncryptionKey, error) {
	panic("not implemented")
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
