package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
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
	createSigningKeyStmt = `
	INSERT INTO signing_keys (id, project_id, key, algorithm, state, activated_at, retired_at, purpose)
	VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)
	THEN RETURN id, created_at
`
	signingKeyQuery = `
	SELECT id, project_id, key, algorithm, state, created_at, activated_at, retired_at, purpose
	FROM signing_keys
`
	updateEncryptionKeyStmt = `UPDATE encryption_keys SET key = @p2 WHERE id = @p1`
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
	if err := ensureManagedID(&key.ID, domain.PrefixEncryptionKey); err != nil {
		return err
	}
	stmt := buildStatement(createEncryptionKeyStmt,
		key.ID, key.ProjectID, key.Key, key.Algorithm, key.State, key.ActivatedAt, key.RetiredAt, key.Purpose,
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&key.ID, &key.CreatedAt)
		})
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
		return nil, database.NewNoRowFoundError(nil)
	}
	if len(keys) > 1 {
		return nil, errTooManyRows
	}
	return keys[0], nil
}

// ListEncryptionKeys implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) ListEncryptionKeys(ctx context.Context, opts *database.ListOptions[domain.EncryptionKeyField]) (*database.ListResult[*domain.EncryptionKey], error) {
	if opts == nil {
		opts = &database.ListOptions[domain.EncryptionKeyField]{}
	}

	var compiler statementCompiler
	if err := compileRead(&compiler, encryptionKeyQuery, opts, encryptionKeySchema); err != nil {
		return nil, err
	}

	var keys []*domain.EncryptionKey
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		keys, err = collectRows(iter, s.scanEncryptionKey)
		return err
	})
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

// UpdateKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) UpdateKey(ctx context.Context, id string, key string) error {
	stmt := buildStatement(updateEncryptionKeyStmt, id, key).statement()
	if _, err := s.db.Update(ctx, stmt); err != nil {
		return wrapError(err)
	}
	return nil
}

func (s cryptoKeyStatements) scanEncryptionKey(row *spanner.Row) (*domain.EncryptionKey, error) {
	key := new(domain.EncryptionKey)
	err := row.Columns(&key.ID, &key.ProjectID, &key.Key, &key.Algorithm, &key.State, &key.CreatedAt, &key.ActivatedAt, &key.RetiredAt, &key.Purpose)
	if err != nil {
		return nil, err
	}
	return key, nil
}

// CreateSigningKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) CreateSigningKey(ctx context.Context, key *domain.SigningKey) error {
	if err := ensureManagedID(&key.ID, domain.PrefixSigningKey); err != nil {
		return err
	}
	stmt := buildStatement(createSigningKeyStmt,
		key.ID, key.ProjectID, key.Key, key.Algorithm, key.State, key.ActivatedAt, key.RetiredAt, key.Purpose,
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&key.ID, &key.CreatedAt)
		})
		return err
	})
}

// GetSigningKey implements [service.CryptoKeyStatements].
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

	var keys []*domain.SigningKey
	err = s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		keys, err = collectRows(iter, s.scanSigningKey)
		return err
	})
	if err != nil {
		return nil, wrapError(err)
	}

	if len(keys) == 0 {
		return nil, database.NewNoRowFoundError(nil)
	}
	if len(keys) > 1 {
		return nil, errTooManyRows
	}
	return keys[0], nil
}

func (s cryptoKeyStatements) scanSigningKey(row *spanner.Row) (*domain.SigningKey, error) {
	key := new(domain.SigningKey)
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
		Accessor: func(k *domain.EncryptionKey) any { return database.NullableValue(k.ActivatedAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.EncryptionKeyFieldRetiredAt: {
		SQLName:  "retired_at",
		Accessor: func(k *domain.EncryptionKey) any { return database.NullableValue(k.RetiredAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
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
		Accessor: func(k *domain.SigningKey) any { return database.NullableValue(k.ActivatedAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.SigningKeyFieldRetiredAt: {
		SQLName:  "retired_at",
		Accessor: func(k *domain.SigningKey) any { return database.NullableValue(k.RetiredAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.SigningKeyFieldPurpose: {
		SQLName:  "purpose",
		Accessor: func(k *domain.SigningKey) any { return k.Purpose },
		Coerce:   database.CoerceString,
	},
})
