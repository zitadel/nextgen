package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const (
	createEncryptionKeyStmt = `
	INSERT INTO zitadel_nextgen.encryption_keys (id, project_id, key, algorithm, state, activated_at, retired_at, purpose)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	RETURNING id, created_at
`
	encryptionKeyQuery = `
	SELECT id, project_id, key, algorithm, state, created_at, activated_at, retired_at, purpose
	FROM zitadel_nextgen.encryption_keys
`
)

type cryptoKeyStatements struct{ statement }

func newCryptoKeyStatements(client queryExecutor) cryptoKeyStatements {
	return cryptoKeyStatements{
		statement{
			client: client,
		},
	}
}

func (s cryptoKeyStatements) CreateEncryptionKey(ctx context.Context, key *domain.EncryptionKey) error {
	return s.client.QueryRow(ctx, createEncryptionKeyStmt,
		key.ID, key.ProjectID, key.Key, key.Algorithm, key.State, key.ActivatedAt, key.RetiredAt, key.Purpose,
	).Scan(&key.ID, &key.CreatedAt)
}

func (s cryptoKeyStatements) GetEncryptionKey(ctx context.Context, filter database.Filter[domain.EncryptionKeyField]) (*domain.EncryptionKey, error) {
	var compiler statementCompiler
	err := compileRead(
		&compiler,
		encryptionKeyQuery,
		&database.ListOptions[domain.EncryptionKeyField]{Filter: filter},
		encryptionKeySchema,
	)
	if err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	key, err := pgx.CollectExactlyOneRow(rows, s.scanEncryptionKey)
	if err != nil {
		return nil, wrapError(err)
	}
	return key, nil
}

func (s cryptoKeyStatements) scanEncryptionKey(row pgx.CollectableRow) (*domain.EncryptionKey, error) {
	key := new(domain.EncryptionKey)
	err := row.Scan(&key.ID, &key.ProjectID, &key.Key, &key.Algorithm, &key.State, &key.CreatedAt, &key.ActivatedAt, &key.RetiredAt, &key.Purpose)
	if err != nil {
		return nil, err
	}
	return key, nil
}

var _ service.CryptoKeyStatements = (*cryptoKeyStatements)(nil)

var encryptionKeySchema = database.NewSchema(map[domain.EncryptionKeyField]database.FieldBinding[domain.EncryptionKey]{
	domain.EncryptionKeyFieldID: {
		SQLName:  "id",
		Accessor: func(k *domain.EncryptionKey) any { return k.ID },
		Coerce:   database.CoerceString,
	},
	domain.EncryptionKeyFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(k *domain.EncryptionKey) any { return k.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.EncryptionKeyFieldKey: {
		SQLName:  "key",
		Accessor: func(k *domain.EncryptionKey) any { return k.Key },
		Coerce:   database.CoerceString,
	},
	domain.EncryptionKeyFieldAlgorithm: {
		SQLName:  "algorithm",
		Accessor: func(k *domain.EncryptionKey) any { return k.Algorithm },
		Coerce:   database.CoerceString,
	},
	domain.EncryptionKeyFieldState: {
		SQLName:  "state",
		Accessor: func(k *domain.EncryptionKey) any { return k.State },
		Coerce:   database.CoerceString,
	},
	domain.EncryptionKeyFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(k *domain.EncryptionKey) any { return k.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.EncryptionKeyFieldActivatedAt: {
		SQLName:  "activated_at",
		Accessor: func(k *domain.EncryptionKey) any { return k.ActivatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.EncryptionKeyFieldRetiredAt: {
		SQLName:  "retired_at",
		Accessor: func(k *domain.EncryptionKey) any { return k.RetiredAt },
		Coerce:   database.CoerceTime,
	},
	domain.EncryptionKeyFieldPurpose: {
		SQLName:  "purpose",
		Accessor: func(k *domain.EncryptionKey) any { return k.Purpose },
		Coerce:   database.CoerceString,
	},
})
