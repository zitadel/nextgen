package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const createTokenStmt = `INSERT INTO zitadel_nextgen.tokens (
	project_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at, created_at
) VALUES (
	$1, $2, $3::zitadel_nextgen.token_types,
	$4, $5, $6,
	$7, $8, now()
) RETURNING token_id`

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

	scope := token.Scope
	if scope == nil {
		scope = []string{}
	}

	var tokenID database.Identity
	err := ts.client.QueryRow(ctx, createTokenStmt,
		token.ProjectID,
		tokenUserIDArg(token.UserID, token.Type),
		token.Type.String(),
		tokenSessionIDArg(token.SessionID),
		tokenSessionIDArg(token.OIDCSessionID),
		tokenSessionIDArg(token.SAMLSessionID),
		scope,
		token.ExpiresAt,
	).Scan(&tokenID)
	if err != nil {
		return wrapError(err)
	}
	if tokenID == "" {
		return fmt.Errorf("failed to create token: no token_id returned")
	}
	token.TokenID = tokenID.String()
	return nil
}

// DeleteTokenByID implements [service.TokenStatements].
func (ts tokenStatements) DeleteTokenByID(ctx context.Context, projectID, tokenID string) error {
	_, err := ts.client.Exec(ctx, deleteByIDTokenStmt, projectID, database.Identity(tokenID))
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

	var nextCursor []byte
	if filter.Pagination.Limit > 0 &&
		len(tokens) == int(filter.Pagination.Limit) &&
		len(filter.Pagination.OrderBy.Columns) > 0 {
		cursor := &pagination.Cursor[domain.TokenField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  tokenSchema.ValuesFrom(tokens[len(tokens)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.Token]{
		Items:      tokens,
		NextCursor: nextCursor,
	}, nil
}

func (ts tokenStatements) scanToken(row pgx.CollectableRow) (*domain.Token, error) {
	token := new(domain.Token)
	var (
		tokenID                          database.Identity
		userID                           *string
		sessionID, oidcSessionID, samlID database.Identity
		scope                            []string
		expiresAt                        *time.Time
	)
	if err := row.Scan(
		&token.ProjectID,
		&tokenID,
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
	token.TokenID = tokenID.String()
	if userID != nil {
		token.UserID = *userID
	}
	if sessionID != "" {
		s := sessionID.String()
		token.SessionID = &s
	}
	if oidcSessionID != "" {
		s := oidcSessionID.String()
		token.OIDCSessionID = &s
	}
	if samlID != "" {
		s := samlID.String()
		token.SAMLSessionID = &s
	}
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

func tokenSessionIDArg(sessionID *string) database.Identity {
	if sessionID == nil {
		return ""
	}
	return database.Identity(*sessionID)
}

func tokenOptionalIdentity(id *string) any {
	if id == nil {
		return nil
	}
	return database.Identity(*id)
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

func coerceTokenIdentity(v any) (any, error) {
	switch id := v.(type) {
	case database.Identity:
		return id, nil
	case string:
		return database.Identity(id), nil
	default:
		s, err := database.CoerceStringValue(v)
		if err != nil {
			return nil, err
		}
		return database.Identity(s), nil
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
		Accessor: func(t *domain.Token) any { return database.Identity(t.TokenID) },
		Coerce:   coerceTokenIdentity,
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
		Accessor: func(t *domain.Token) any { return tokenOptionalIdentity(t.SessionID) },
		Coerce:   coerceTokenIdentity,
	},
	domain.TokenFieldOIDCSessionID: {
		SQLName:  "oidc_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalIdentity(t.OIDCSessionID) },
		Coerce:   coerceTokenIdentity,
	},
	domain.TokenFieldSAMLSessionID: {
		SQLName:  "saml_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalIdentity(t.SAMLSessionID) },
		Coerce:   coerceTokenIdentity,
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
