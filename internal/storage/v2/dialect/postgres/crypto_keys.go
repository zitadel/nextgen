package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain/crypto"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type cryptoKeyStatements struct{ statement }

func newCryptoKeyStatements(client queryExecutor) cryptoKeyStatements {
	return cryptoKeyStatements{
		statement{
			client: client,
		},
	}
}

const createDEKStmt = `
	INSERT INTO zitadel_nextgen.deks (id, project_id, key, algorithm, state, activated_at, retired_at, purpose)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	RETURNING id, created_at
`

func (s cryptoKeyStatements) CreateEncryptionKey(ctx context.Context, key *crypto.EncryptionKey) error {
	return s.client.QueryRow(ctx, createDEKStmt,
		key.Id, key.ProjectID, key.Key, key.Algorithm, key.State, key.ActivatedAt, key.RetiredAt, key.Purpose,
	).Scan(&key.Id, &key.CreatedAt)
}

const updateDEKStmt = `
	UPDATE zitadel_nextgen.deks 
	SET state = $1, created_at = $2, activated_at = $3, retired_at = $4
	WHERE project_id = $5 AND id = $6
`

func (s cryptoKeyStatements) UpdateEncryptionKey(ctx context.Context, dek *crypto.EncryptionKey) error {
	_, err := s.client.Exec(ctx, updateDEKStmt, dek.State, dek.CreatedAt, dek.ActivatedAt, dek.RetiredAt, dek.ProjectID, dek.Id)
	return err
}

const encryptionKeyQuery = `
	SELECT id, project_id, key, algorithm, state, created_at, activated_at, retired_at, purpose
	FROM zitadel_nextgen.deks
`

func (s cryptoKeyStatements) GetEncryptionKey(ctx context.Context, filter database.Filter[crypto.EncryptionKeyField]) (*crypto.EncryptionKey, error) {
	var compiler statementCompiler
	err := compileRead(
		&compiler,
		encryptionKeyQuery,
		&database.ListOptions[crypto.EncryptionKeyField]{Filter: filter},
		dekSchema,
	)
	if err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	dek, err := pgx.CollectExactlyOneRow(rows, s.scanEncryptionKey)
	if err != nil {
		return nil, wrapError(err)
	}
	return dek, nil
}

func (s cryptoKeyStatements) scanEncryptionKey(row pgx.CollectableRow) (*crypto.EncryptionKey, error) {
	key := new(crypto.EncryptionKey)
	err := row.Scan(&key.Id, &key.ProjectID, &key.Key, &key.Algorithm, &key.State, &key.CreatedAt, &key.ActivatedAt, &key.RetiredAt, &key.Purpose)
	if err != nil {
		return nil, err
	}
	return key, nil
}

var _ service.CryptoKeyStatements = (*cryptoKeyStatements)(nil)

var dekSchema = database.NewSchema(map[crypto.EncryptionKeyField]database.FieldBinding[crypto.EncryptionKey]{
	crypto.EncryptionKeyFieldID: {
		SQLName:  "id",
		Accessor: func(k *crypto.EncryptionKey) any { return k.Id },
		Coerce:   database.CoerceString,
	},
	crypto.EncryptionKeyFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(k *crypto.EncryptionKey) any { return k.ProjectID },
		Coerce:   database.CoerceString,
	},
	crypto.EncryptionKeyFieldKey: {
		SQLName:  "key",
		Accessor: func(k *crypto.EncryptionKey) any { return k.Key },
		Coerce:   database.CoerceBytes,
	},
	crypto.EncryptionKeyFieldAlgorithm: {
		SQLName:  "algorithm",
		Accessor: func(k *crypto.EncryptionKey) any { return k.Algorithm },
		Coerce:   database.CoerceString,
	},
	crypto.EncryptionKeyFieldState: {
		SQLName:  "state",
		Accessor: func(k *crypto.EncryptionKey) any { return k.State },
		Coerce:   database.CoerceString,
	},
	crypto.EncryptionKeyFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(k *crypto.EncryptionKey) any { return k.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	crypto.EncryptionKeyFieldActivatedAt: {
		SQLName:  "activated_at",
		Accessor: func(k *crypto.EncryptionKey) any { return k.ActivatedAt },
		Coerce:   database.CoerceTime,
	},
	crypto.EncryptionKeyFieldRetiredAt: {
		SQLName:  "retired_at",
		Accessor: func(k *crypto.EncryptionKey) any { return k.RetiredAt },
		Coerce:   database.CoerceTime,
	},
	crypto.EncryptionKeyFieldPurpose: {
		SQLName:  "purpose",
		Accessor: func(k *crypto.EncryptionKey) any { return k.Purpose },
	},
})
