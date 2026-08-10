package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
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
	updateEncryptionKeyStmt = `UPDATE zitadel_nextgen.encryption_keys SET key = $2 WHERE id = $1`

	createSigningKeyStmt = `
	INSERT INTO zitadel_nextgen.signing_keys (id, project_id, key, algorithm, state, activated_at, retired_at, purpose)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	RETURNING id, created_at
`
	signingKeyQuery = `
	SELECT id, project_id, key, algorithm, state, created_at, activated_at, retired_at, purpose
	FROM zitadel_nextgen.signing_keys
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
	if err := ensureManagedID(&key.ID, domain.PrefixEncryptionKey); err != nil {
		return err
	}
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

func (s cryptoKeyStatements) CreateSigningKey(ctx context.Context, key *domain.SigningKey) error {
	if err := ensureManagedID(&key.ID, domain.PrefixSigningKey); err != nil {
		return err
	}
	return s.client.QueryRow(ctx, createSigningKeyStmt,
		key.ID, key.ProjectID, key.Key, key.Algorithm, key.State, key.ActivatedAt, key.RetiredAt, key.Purpose,
	).Scan(&key.ID, &key.CreatedAt)
}

func (s cryptoKeyStatements) GetSigningKey(ctx context.Context, filter database.Filter[domain.SigningKeyField]) (*domain.SigningKey, error) {
	var compiler statementCompiler
	err := compileRead(
		&compiler,
		signingKeyQuery,
		&database.ListOptions[domain.SigningKeyField]{Filter: filter},
		signingKeySchema,
	)
	if err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	key, err := pgx.CollectExactlyOneRow(rows, s.scanSigningKey)
	if err != nil {
		return nil, wrapError(err)
	}
	return key, nil
}

func (s cryptoKeyStatements) ListEncryptionKeys(ctx context.Context, opts *database.ListOptions[domain.EncryptionKeyField]) (*database.ListResult[*domain.EncryptionKey], error) {
	if opts == nil {
		opts = &database.ListOptions[domain.EncryptionKeyField]{}
	}

	var compiler statementCompiler
	if err := compileRead(&compiler, encryptionKeyQuery, opts, encryptionKeySchema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	keys, err := pgx.CollectRows(rows, s.scanEncryptionKey)
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if opts.Pagination.Limit > 0 && len(keys) == int(opts.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.EncryptionKeyField]{
			Columns: opts.Pagination.OrderBy.Columns,
			Values:  encryptionKeySchema.ValuesFrom(keys[len(keys)-1], opts.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.EncryptionKey]{
		Items:      keys,
		NextCursor: nextCursor,
	}, nil
}

func (s cryptoKeyStatements) UpdateKey(ctx context.Context, id string, key string) error {
	if _, err := s.client.Exec(ctx, updateEncryptionKeyStmt, id, key); err != nil {
		return wrapError(err)
	}
	return nil
}

func (s cryptoKeyStatements) scanEncryptionKey(row pgx.CollectableRow) (*domain.EncryptionKey, error) {
	key := new(domain.EncryptionKey)
	err := row.Scan(&key.ID, &key.ProjectID, &key.Key, &key.Algorithm, &key.State, &key.CreatedAt, &key.ActivatedAt, &key.RetiredAt, &key.Purpose)
	if err != nil {
		return nil, err
	}
	return key, nil
}

func (s cryptoKeyStatements) scanSigningKey(row pgx.CollectableRow) (*domain.SigningKey, error) {
	key := new(domain.SigningKey)
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

var signingKeySchema = database.NewSchema(map[domain.SigningKeyField]database.FieldBinding[domain.SigningKey]{
	domain.SigningKeyFieldID: {
		SQLName:  "id",
		Accessor: func(k *domain.SigningKey) any { return k.ID },
		Coerce:   database.CoerceString,
	},
	domain.SigningKeyFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(k *domain.SigningKey) any { return k.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.SigningKeyFieldKey: {
		SQLName:  "key",
		Accessor: func(k *domain.SigningKey) any { return k.Key },
		Coerce:   database.CoerceString,
	},
	domain.SigningKeyFieldAlgorithm: {
		SQLName:  "algorithm",
		Accessor: func(k *domain.SigningKey) any { return k.Algorithm },
		Coerce:   database.CoerceString,
	},
	domain.SigningKeyFieldState: {
		SQLName:  "state",
		Accessor: func(k *domain.SigningKey) any { return k.State },
		Coerce:   database.CoerceString,
	},
	domain.SigningKeyFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(k *domain.SigningKey) any { return k.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.SigningKeyFieldActivatedAt: {
		SQLName:  "activated_at",
		Accessor: func(k *domain.SigningKey) any { return k.ActivatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.SigningKeyFieldRetiredAt: {
		SQLName:  "retired_at",
		Accessor: func(k *domain.SigningKey) any { return k.RetiredAt },
		Coerce:   database.CoerceTime,
	},
	domain.SigningKeyFieldPurpose: {
		SQLName:  "purpose",
		Accessor: func(k *domain.SigningKey) any { return k.Purpose },
		Coerce:   database.CoerceString,
	},
})
