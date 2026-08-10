package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createTokenStmt = `INSERT INTO tokens (
	project_id, token_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING created_at`

	deleteByIDTokenStmt = `DELETE FROM tokens WHERE project_id = ? AND token_id = ?`

	tokenQuery = `SELECT project_id, token_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at, created_at
FROM tokens`
)

type tokenStatements struct{ statement }

func newTokenStatements(client queryExecutor) tokenStatements {
	return tokenStatements{statement: statement{client: client}}
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
	scopeJSON, err := encodeJSON(scope)
	if err != nil {
		return wrapError(err)
	}

	now := nowUnixNano()
	var createdNano int64
	err = ts.client.QueryRow(ctx, createTokenStmt,
		token.ProjectID,
		token.TokenID,
		tokenUserIDArg(token.UserID, token.Type),
		token.Type.String(),
		tokenSessionIDArg(token.SessionID),
		tokenSessionIDArg(token.OIDCSessionID),
		tokenSessionIDArg(token.SAMLSessionID),
		scopeJSON,
		nullUnixNano(token.ExpiresAt),
		now,
	).Scan(&createdNano)
	if err != nil {
		return wrapError(err)
	}
	token.CreatedAt = timeFromUnixNano(createdNano)
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
	defer rows.Close()
	tok, err := collectExactlyOneRow(rows, scanToken)
	if err != nil {
		return nil, wrapError(err)
	}
	return tok, nil
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
	defer rows.Close()
	tokens, err := collectRows(rows, scanToken)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		tokens,
		tokenSchema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.Token]{Items: tokens, NextCursor: nextCursor}, nil
}

func scanToken(rows *sql.Rows) (*domain.Token, error) {
	token := new(domain.Token)
	var (
		userID                           sql.NullString
		sessionID, oidcSessionID, samlID sql.NullString
		scopeStr                         string
		expiresAtNano                    sql.NullInt64
		tokenType                        string
		createdNano                      int64
	)
	if err := rows.Scan(
		&token.ProjectID,
		&token.TokenID,
		&userID,
		&tokenType,
		&sessionID,
		&oidcSessionID,
		&samlID,
		&scopeStr,
		&expiresAtNano,
		&createdNano,
	); err != nil {
		return nil, err
	}
	if err := token.Type.Scan(tokenType); err != nil {
		return nil, err
	}
	if userID.Valid {
		token.UserID = userID.String
	}
	if sessionID.Valid && sessionID.String != "" {
		s := sessionID.String
		token.SessionID = &s
	}
	if oidcSessionID.Valid && oidcSessionID.String != "" {
		s := oidcSessionID.String
		token.OIDCSessionID = &s
	}
	if samlID.Valid && samlID.String != "" {
		s := samlID.String
		token.SAMLSessionID = &s
	}
	scope, err := decodeJSONStrings(scopeStr)
	if err != nil {
		return nil, fmt.Errorf("decode token scope: %w", err)
	}
	if scope == nil {
		token.Scope = []string{}
	} else {
		token.Scope = scope
	}
	if expiresAtNano.Valid {
		exp := timeFromUnixNano(expiresAtNano.Int64)
		token.ExpiresAt = &exp
	}
	token.CreatedAt = timeFromUnixNano(createdNano)
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
