package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const createTokenStmt = `INSERT INTO zitadel_nextgen.tokens (
	project_id, token_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at, created_at
) VALUES (
	$1, $2, $3, $4::zitadel_nextgen.token_types,
	$5, $6, $7,
	$8, $9, now()
) RETURNING created_at`

const deleteByIDTokenStmt = `DELETE FROM zitadel_nextgen.tokens WHERE project_id = $1 AND token_id = $2`

const tokenQuery = `SELECT project_id, token_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at, created_at
FROM zitadel_nextgen.tokens`

type tokenStatements struct{ statement }

func newTokenStatements(client queryExecutor) tokenStatements {
	return tokenStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateToken implements [service.TokenStatements].
func (ts tokenStatements) CreateToken(ctx context.Context, token *domain.Token) error {
	if err := token.ValidatePersisted(); err != nil {
		return err
	}
	if token.TokenID != "" {
		return fmt.Errorf("token_id must not be set on create")
	}
	if err := ensureManagedID(&token.TokenID, domain.TokenPrefix); err != nil {
		return err
	}

	scope := token.Scope
	if scope == nil {
		scope = []string{}
	}

	err := ts.client.QueryRow(ctx, createTokenStmt,
		token.ProjectID,
		token.TokenID,
		tokenUserIDArg(token.UserID, token.Type),
		token.Type.String(),
		tokenSessionIDArg(token.SessionID),
		tokenSessionIDArg(token.OIDCSessionID),
		tokenSessionIDArg(token.SAMLSessionID),
		scope,
		token.ExpiresAt,
	).Scan(&token.CreatedAt)
	if err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteTokenByID implements [service.TokenStatements].
func (ts tokenStatements) DeleteTokenByID(ctx context.Context, projectID, tokenID string) error {
	_, err := ts.client.Exec(ctx, deleteByIDTokenStmt, projectID, tokenID)
	return wrapError(err)
}

// GetTokenByID implements [service.TokenStatements].
func (ts tokenStatements) GetTokenByID(ctx context.Context, projectID, tokenID string) (*domain.Token, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, tokenQuery, &database.ListOptions[domain.TokenField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
			database.Equal(database.Col(domain.TokenFieldTokenID), tokenID),
		),
	}, tokenSchema); err != nil {
		return nil, err
	}

	rows, err := ts.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	token, err := pgx.CollectExactlyOneRow(rows, ts.scanToken)
	if err != nil {
		return nil, wrapError(err)
	}
	return token, nil
}

// ListTokens implements [service.TokenStatements].
func (ts tokenStatements) ListTokens(ctx context.Context, filter *database.ListOptions[domain.TokenField]) (*database.ListResult[*domain.Token], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, tokenQuery, filter, tokenSchema); err != nil {
		return nil, err
	}

	rows, err := ts.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	tokens, err := pgx.CollectRows(rows, ts.scanToken)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		tokens,
		tokenSchema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.Token]{
		Items:      tokens,
		NextCursor: nextCursor,
	}, nil
}

func (ts tokenStatements) scanToken(row pgx.CollectableRow) (*domain.Token, error) {
	token := new(domain.Token)
	var (
		userID                           *string
		sessionID, oidcSessionID, samlID *string
		scope                            []string
		expiresAt                        *time.Time
	)
	if err := row.Scan(
		&token.ProjectID,
		&token.TokenID,
		&userID,
		&token.Type,
		&sessionID,
		&oidcSessionID,
		&samlID,
		&scope,
		&expiresAt,
		&token.CreatedAt,
	); err != nil {
		return nil, err
	}
	if userID != nil {
		token.UserID = *userID
	}
	token.SessionID = sessionID
	token.OIDCSessionID = oidcSessionID
	token.SAMLSessionID = samlID
	if scope == nil {
		token.Scope = []string{}
	} else {
		token.Scope = scope
	}
	token.ExpiresAt = expiresAt
	return token, nil
}

func tokenUserIDArg(userID string, tokenType domain.TokenType) any {
	if tokenType == domain.TokenTypeSessionToken && userID == "" {
		return nil
	}
	return userID
}

func tokenSessionIDArg(sessionID *string) any {
	if sessionID == nil || *sessionID == "" {
		return nil
	}
	return *sessionID
}

func tokenOptionalString(id *string) any {
	if id == nil || *id == "" {
		return nil
	}
	return *id
}

func coerceTokenType(v any) (any, error) {
	switch t := v.(type) {
	case domain.TokenType:
		return t.String(), nil
	case string:
		parsed, err := domain.TokenTypeString(t)
		if err != nil {
			return nil, err
		}
		return parsed.String(), nil
	default:
		return nil, database.ErrCoerceExpectedType("token type", v)
	}
}

var _ service.TokenStatements = (*tokenStatements)(nil)

var tokenSchema = database.NewSchema(map[domain.TokenField]database.FieldBinding[domain.Token]{
	domain.TokenFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(t *domain.Token) any { return t.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.TokenFieldTokenID: {
		SQLName:  "token_id",
		Accessor: func(t *domain.Token) any { return t.TokenID },
		Coerce:   database.CoerceString,
	},
	domain.TokenFieldUserID: {
		SQLName: "user_id",
		// user_id is NULL for anonymous session tokens; "" is never stored.
		Accessor: func(t *domain.Token) any {
			if t.UserID == "" {
				return nil
			}
			return t.UserID
		},
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.TokenFieldType: {
		SQLName:  "token_type",
		Accessor: func(t *domain.Token) any { return t.Type.String() },
		Coerce:   coerceTokenType,
	},
	domain.TokenFieldSessionID: {
		SQLName:  "session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.SessionID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.TokenFieldOIDCSessionID: {
		SQLName:  "oidc_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.OIDCSessionID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.TokenFieldSAMLSessionID: {
		SQLName:  "saml_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.SAMLSessionID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	domain.TokenFieldScope: {
		SQLName:  "scope",
		Accessor: func(t *domain.Token) any { return t.Scope },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
	domain.TokenFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(t *domain.Token) any { return database.NullableValue(t.ExpiresAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.TokenFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(t *domain.Token) any { return t.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
