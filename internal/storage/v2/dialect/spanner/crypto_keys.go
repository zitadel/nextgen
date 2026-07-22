package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	database2 "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const (
	createEncryptionKeyStmt = `
	INSERT INTO encryption_keys (id, project_id, key, algorithm, state, activated_at, retired_at, purpose)
	VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)
	THEN RETURN id, created_at
`
	encryptionKeyQuery = `
	SELECT id, project_id, key, algorithm, state, created_at, activated_at, retired_at, purpose
	FROM encryption_keys
`
)

type cryptoKeyStatements struct{ statement }

func newCryptoKeyStatements(db queryExecutor) cryptoKeyStatements {
	return cryptoKeyStatements{
		statement{
			db: db,
		},
	}
}

// CreateEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) CreateEncryptionKey(ctx context.Context, key *domain.EncryptionKey) error {
	stmt := buildStatement(createEncryptionKeyStmt,
		key.ID, key.ProjectID, key.Key, key.Algorithm, key.State, key.ActivatedAt, key.RetiredAt, key.Purpose,
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&key.ID, &key.CreatedAt)
		})
		if err != nil {
			panic(err)
		}
		return err
	})
}

// GetEncryptionKey implements [service.CryptoKeyStatements].
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

	var keys []*domain.EncryptionKey
	err = s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		keys, err = collectRows(iter, s.scanEncryptionKey)
		return err
	})
	if err != nil {
		return nil, wrapError(err)
	}

	if len(keys) == 0 {
		return nil, database2.NewNoRowFoundError(nil)
	}
	if len(keys) > 1 {
		return nil, errTooManyRows
	}
	return keys[0], nil
}

func (s cryptoKeyStatements) scanEncryptionKey(row *spanner.Row) (*domain.EncryptionKey, error) {
	key := new(domain.EncryptionKey)
	err := row.Columns(&key.ID, &key.ProjectID, &key.Key, &key.Algorithm, &key.State, &key.CreatedAt, &key.ActivatedAt, &key.RetiredAt, &key.Purpose)
	if err != nil {
		return nil, err
	}
	return key, nil
}

// IsStatements implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) IsStatements() {}

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
