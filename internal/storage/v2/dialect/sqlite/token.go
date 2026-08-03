package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	createTokenStmt = `INSERT INTO tokens (
	project_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING token_id, created_at`

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

	scope := token.Scope
	if scope == nil {
		scope = []string{}
	}
	scopeJSON, err := encodeJSON(scope)
	if err != nil {
		return wrapError(err)
	}

	sessionID, err := tokenSessionIDArg(token.SessionID)
	if err != nil {
		return err
	}
	oidcSessionID, err := tokenSessionIDArg(token.OIDCSessionID)
	if err != nil {
		return err
	}
	samlSessionID, err := tokenSessionIDArg(token.SAMLSessionID)
	if err != nil {
		return err
	}

	now := nowUnixNano()
	var tokenID, createdNano int64
	err = ts.client.QueryRow(ctx, createTokenStmt,
		token.ProjectID,
		tokenUserIDArg(token.UserID, token.Type),
		token.Type.String(),
		sessionID,
		oidcSessionID,
		samlSessionID,
		scopeJSON,
		nullUnixNano(token.ExpiresAt),
		now,
	).Scan(&tokenID, &createdNano)
	if err != nil {
		return wrapError(err)
	}
	token.TokenID = strconv.FormatInt(tokenID, 10)
	token.CreatedAt = timeFromUnixNano(createdNano)
	return nil
}

// DeleteTokenByID implements [service.TokenStatements].
func (ts tokenStatements) DeleteTokenByID(ctx context.Context, projectID, tokenID string) error {
	id, err := parseIdentity(tokenID)
	if err != nil {
		return fmt.Errorf("invalid token_id %q: %w", tokenID, err)
	}
	_, err = ts.client.Exec(ctx, deleteByIDTokenStmt, projectID, id)
	return wrapError(err)
}

// GetTokenByID implements [service.TokenStatements].
func (ts tokenStatements) GetTokenByID(ctx context.Context, projectID, tokenID string) (*domain.Token, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, tokenQuery, &database.ListOptions[domain.TokenField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
			database.Equal(database.Col(domain.TokenFieldTokenID), database.Identity(tokenID)),
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
	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(tokens) == int(filter.Pagination.Limit) && len(filter.Pagination.OrderBy.Columns) > 0 {
		cursor := &pagination.Cursor[domain.TokenField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  tokenSchema.ValuesFrom(tokens[len(tokens)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}
	return &database.ListResult[*domain.Token]{Items: tokens, NextCursor: nextCursor}, nil
}

func scanToken(rows *sql.Rows) (*domain.Token, error) {
	token := new(domain.Token)
	var (
		tokenID                          int64
		userID                           sql.NullString
		sessionID, oidcSessionID, samlID sql.NullInt64
		scopeStr                         string
		expiresAtNano                    sql.NullInt64
		tokenType                        string
		createdNano                      int64
	)
	if err := rows.Scan(
		&token.ProjectID,
		&tokenID,
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
	token.TokenID = strconv.FormatInt(tokenID, 10)
	if err := token.Type.Scan(tokenType); err != nil {
		return nil, err
	}
	if userID.Valid {
		token.UserID = userID.String
	}
	if sessionID.Valid {
		s := strconv.FormatInt(sessionID.Int64, 10)
		token.SessionID = &s
	}
	if oidcSessionID.Valid {
		s := strconv.FormatInt(oidcSessionID.Int64, 10)
		token.OIDCSessionID = &s
	}
	if samlID.Valid {
		s := strconv.FormatInt(samlID.Int64, 10)
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

func tokenSessionIDArg(sessionID *string) (any, error) {
	if sessionID == nil || *sessionID == "" {
		return nil, nil
	}
	id, err := parseIdentity(*sessionID)
	if err != nil {
		return nil, fmt.Errorf("invalid session id %q: %w", *sessionID, err)
	}
	return id, nil
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

func coerceTokenInt64(v any) (any, error) {
	switch id := v.(type) {
	case int64:
		return id, nil
	case string:
		return strconv.ParseInt(id, 10, 64)
	case database.Identity:
		return strconv.ParseInt(string(id), 10, 64)
	default:
		s, err := database.CoerceStringValue(v)
		if err != nil {
			return nil, err
		}
		return strconv.ParseInt(s, 10, 64)
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
		Coerce:   coerceTokenInt64,
	},
	domain.TokenFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(t *domain.Token) any { return t.UserID },
		Coerce:   database.CoerceString,
	},
	domain.TokenFieldType: {
		SQLName:  "token_type",
		Accessor: func(t *domain.Token) any { return t.Type.String() },
		Coerce:   coerceTokenType,
	},
	domain.TokenFieldSessionID: {
		SQLName:  "session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.SessionID) },
		Coerce:   coerceTokenInt64,
	},
	domain.TokenFieldOIDCSessionID: {
		SQLName:  "oidc_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.OIDCSessionID) },
		Coerce:   coerceTokenInt64,
	},
	domain.TokenFieldSAMLSessionID: {
		SQLName:  "saml_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.SAMLSessionID) },
		Coerce:   coerceTokenInt64,
	},
	domain.TokenFieldScope: {
		SQLName:  "scope",
		Accessor: func(t *domain.Token) any { return t.Scope },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
	domain.TokenFieldExpiresAt: {
		SQLName: "expires_at",
		Accessor: func(t *domain.Token) any {
			if t.ExpiresAt == nil {
				return (*time.Time)(nil)
			}
			return *t.ExpiresAt
		},
		Coerce: database.CoerceTime,
	},
	domain.TokenFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(t *domain.Token) any { return t.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
