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
	INSERT INTO zitadel_nextgen.deks (id, project_id, key, algorithm, state, activated_at, retired_at)
	VALUES ($1, $2, $3, $4, $5, $6, $7)
	RETURNING id, created_at
`

func (s cryptoKeyStatements) CreateDEK(ctx context.Context, dek *crypto.DEK) error {
	return s.client.QueryRow(ctx, createDEKStmt, dek.Id, dek.ProjectID, dek.Key, dek.Algorithm, dek.State, dek.ActivatedAt, dek.RetiredAt).
		Scan(&dek.Id, &dek.CreatedAt)
}

const updateDEKStmt = `
	UPDATE zitadel_nextgen.deks 
	SET state = $1, created_at = $2, activated_at = $3, retired_at = $4
	WHERE project_id = $5 AND id = $6
`

func (s cryptoKeyStatements) UpdateDEK(ctx context.Context, dek *crypto.DEK) error {
	_, err := s.client.Exec(ctx, updateDEKStmt, dek.State, dek.CreatedAt, dek.ActivatedAt, dek.RetiredAt, dek.ProjectID, dek.Id)
	return err
}

const dekQuery = `
	SELECT id, project_id, key, algorithm, state, created_at, activated_at, retired_at
	FROM zitadel_nextgen.deks
`

func (s cryptoKeyStatements) GetActiveDEK(ctx context.Context, projectID string) (*crypto.DEK, error) {
	var compiler statementCompiler
	err := compileRead(&compiler, dekQuery, &database.ListOptions[crypto.DEKField]{
		Filter: database.And(
			database.Equal(database.Col(crypto.DEKFieldProjectID), projectID),
			database.Equal(database.Col(crypto.DEKFieldState), crypto.KeyStateActive),
		),
	}, dekSchema)
	if err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	dek, err := pgx.CollectExactlyOneRow(rows, s.scanDEK)
	if err != nil {
		return nil, wrapError(err)
	}
	return dek, nil
}

func (s cryptoKeyStatements) scanDEK(row pgx.CollectableRow) (*crypto.DEK, error) {
	dek := new(crypto.DEK)
	err := row.Scan(&dek.Id, &dek.ProjectID, &dek.Key, &dek.Algorithm, &dek.State, &dek.CreatedAt, &dek.ActivatedAt, &dek.RetiredAt)
	if err != nil {
		return nil, err
	}
	return dek, nil
}

var _ service.CryptoKeyStatements = (*cryptoKeyStatements)(nil)

var dekSchema = database.NewSchema(map[crypto.DEKField]database.FieldBinding[crypto.DEK]{
	crypto.DEKFieldID: {
		SQLName:  "id",
		Accessor: func(k *crypto.DEK) any { return k.Id },
		Coerce:   database.CoerceString,
	},
	crypto.DEKFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(k *crypto.DEK) any { return k.ProjectID },
		Coerce:   database.CoerceString,
	},
	crypto.DEKFieldKey: {
		SQLName:  "key",
		Accessor: func(k *crypto.DEK) any { return k.Key },
		Coerce:   database.CoerceBytes,
	},
	crypto.DEKFieldAlgorithm: {
		SQLName:  "algorithm",
		Accessor: func(k *crypto.DEK) any { return k.Algorithm },
		Coerce:   database.CoerceString,
	},
	crypto.DEKFieldState: {
		SQLName:  "state",
		Accessor: func(k *crypto.DEK) any { return k.State },
		Coerce:   database.CoerceString,
	},
	crypto.DEKFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(k *crypto.DEK) any { return k.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	crypto.DEKFieldActivatedAt: {
		SQLName:  "activated_at",
		Accessor: func(k *crypto.DEK) any { return k.ActivatedAt },
		Coerce:   database.CoerceTime,
	},
	crypto.DEKFieldRetiredAt: {
		SQLName:  "retired_at",
		Accessor: func(k *crypto.DEK) any { return k.RetiredAt },
		Coerce:   database.CoerceTime,
	},
})
