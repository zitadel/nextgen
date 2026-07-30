package sqlite

import (
	"context"
	"database/sql"

	"github.com/go-jose/go-jose/v4"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	createEncryptionKeyStmt = `INSERT INTO encryption_keys
(id, project_id, key, algorithm, state, activated_at, retired_at, purpose, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, created_at`

	encryptionKeyQuery = `SELECT id, project_id, key, algorithm, state, created_at, activated_at, retired_at, purpose
FROM encryption_keys`

	updateEncryptionKeyStmt = `UPDATE encryption_keys SET key = ? WHERE id = ?`
)

type cryptoKeyStatements struct{ statement }

func newCryptoKeyStatements(client queryExecutor) cryptoKeyStatements {
	return cryptoKeyStatements{statement: statement{client: client}}
}

// CreateEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) CreateEncryptionKey(ctx context.Context, key *domain.EncryptionKey) error {
	now := nowUnixNano()
	var createdNano int64
	err := s.client.QueryRow(ctx, createEncryptionKeyStmt,
		key.ID, key.ProjectID, key.Key, string(key.Algorithm), string(key.State),
		nullUnixNano(key.ActivatedAt), nullUnixNano(key.RetiredAt), string(key.Purpose), now,
	).Scan(&key.ID, &createdNano)
	if err != nil {
		return wrapError(err)
	}
	key.CreatedAt = timeFromUnixNano(createdNano)
	return nil
}

// GetEncryptionKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) GetEncryptionKey(ctx context.Context, filter database.Filter[domain.EncryptionKeyField]) (*domain.EncryptionKey, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, encryptionKeyQuery, &database.ListOptions[domain.EncryptionKeyField]{Filter: filter}, encryptionKeySchema); err != nil {
		return nil, err
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	key, err := collectExactlyOneRow(rows, scanEncryptionKey)
	if err != nil {
		return nil, wrapError(err)
	}
	return key, nil
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
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	keys, err := collectRows(rows, scanEncryptionKey)
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
	return &database.ListResult[*domain.EncryptionKey]{Items: keys, NextCursor: nextCursor}, nil
}

// UpdateKey implements [service.CryptoKeyStatements].
func (s cryptoKeyStatements) UpdateKey(ctx context.Context, id string, key string) error {
	_, err := s.client.Exec(ctx, updateEncryptionKeyStmt, key, id)
	return wrapError(err)
}

func scanEncryptionKey(rows *sql.Rows) (*domain.EncryptionKey, error) {
	key := new(domain.EncryptionKey)
	var (
		algorithmStr, stateStr, purposeStr string
		createdNano                        int64
		activatedNano, retiredNano         sql.NullInt64
	)
	if err := rows.Scan(
		&key.ID, &key.ProjectID, &key.Key, &algorithmStr, &stateStr,
		&createdNano, &activatedNano, &retiredNano, &purposeStr,
	); err != nil {
		return nil, err
	}
	key.Algorithm = jose.ContentEncryption(algorithmStr)
	key.State = domain.KeyState(stateStr)
	key.Purpose = domain.EncryptionKeyPurpose(purposeStr)
	key.CreatedAt = timeFromUnixNano(createdNano)
	if activatedNano.Valid {
		t := timeFromUnixNano(activatedNano.Int64)
		key.ActivatedAt = &t
	}
	if retiredNano.Valid {
		t := timeFromUnixNano(retiredNano.Int64)
		key.RetiredAt = &t
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
		Accessor: func(k *domain.EncryptionKey) any { return string(k.Algorithm) },
		Coerce:   database.CoerceString,
	},
	domain.EncryptionKeyFieldState: {
		SQLName:  "state",
		Accessor: func(k *domain.EncryptionKey) any { return string(k.State) },
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
		Accessor: func(k *domain.EncryptionKey) any { return string(k.Purpose) },
		Coerce:   database.CoerceString,
	},
})
