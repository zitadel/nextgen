package spanner

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	tokensTable     = "tokens"
	createTokenStmt = `INSERT INTO tokens (
	project_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at
) VALUES (
	@p1, @p2, @p3,
	@p4, @p5, @p6,
	@p7, @p8
) THEN RETURN token_id`
	deleteByIDTokenStmt = `DELETE FROM tokens WHERE project_id = @p1 AND token_id = @p2`
	tokenQuery          = `SELECT project_id, token_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at, created_at
FROM tokens`
)

var tokenColumns = []string{
	"project_id", "token_id", "user_id", "token_type",
	"session_id", "oidc_session_id", "saml_session_id",
	"scope", "expires_at", "created_at",
}

type tokenStatements struct{ statement }

func newTokenStatements(db queryExecutor) tokenStatements {
	return tokenStatements{
		statement: statement{
			db: db,
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

	stmt := buildStatement(createTokenStmt,
		token.ProjectID,
		tokenUserIDArg(token.UserID, token.Type),
		token.Type.String(),
		sessionID,
		oidcSessionID,
		samlSessionID,
		scope,
		tokenExpiresAtArg(token.ExpiresAt),
	).statement()

	var tokenID int64
	err = ts.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&tokenID)
		})
		return err
	})
	if err != nil {
		return err
	}
	token.TokenID = strconv.FormatInt(tokenID, 10)
	return nil
}

// DeleteTokenByID implements [service.TokenStatements].
func (ts tokenStatements) DeleteTokenByID(ctx context.Context, projectID, tokenID string) error {
	id, err := parseTokenIdentity(tokenID)
	if err != nil {
		return err
	}
	stmt := buildStatement(deleteByIDTokenStmt, projectID, id).statement()
	_, err = ts.db.Update(ctx, stmt)
	return err
}

// GetTokenByID implements [service.TokenStatements].
func (ts tokenStatements) GetTokenByID(ctx context.Context, projectID, tokenID string) (*domain.Token, error) {
	id, err := parseTokenIdentity(tokenID)
	if err != nil {
		return nil, err
	}
	row, err := ts.db.ReadRow(ctx, tokensTable, spanner.Key{projectID, id}, tokenColumns)
	if err != nil {
		return nil, err
	}
	return ts.scanToken(row)
}

// ListTokens implements [service.TokenStatements].
func (ts tokenStatements) ListTokens(ctx context.Context, filter *database.ListOptions[domain.TokenField]) (*database.ListResult[*domain.Token], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, tokenQuery, filter, tokenSchema); err != nil {
		return nil, err
	}

	var tokens []*domain.Token
	err := ts.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		tokens, err = collectRows(iter, ts.scanToken)
		return err
	})
	if err != nil {
		return nil, err
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

func (ts tokenStatements) scanToken(row *spanner.Row) (*domain.Token, error) {
	token := new(domain.Token)
	var (
		tokenID                          int64
		userID                           spanner.NullString
		sessionID, oidcSessionID, samlID spanner.NullInt64
		scope                            []string
		expiresAt                        spanner.NullTime
		tokenType                        string
	)
	if err := row.Columns(
		&token.ProjectID,
		&tokenID,
		&userID,
		&tokenType,
		&sessionID,
		&oidcSessionID,
		&samlID,
		&scope,
		&expiresAt,
		&token.CreatedAt,
	); err != nil {
		return nil, err
	}
	token.TokenID = strconv.FormatInt(tokenID, 10)
	if err := token.Type.Scan(tokenType); err != nil {
		return nil, err
	}
	if userID.Valid {
		token.UserID = userID.StringVal
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
	if scope == nil {
		token.Scope = []string{}
	} else {
		token.Scope = scope
	}
	if expiresAt.Valid {
		exp := expiresAt.Time
		token.ExpiresAt = &exp
	}
	return token, nil
}

func parseTokenIdentity(tokenID string) (int64, error) {
	id, err := strconv.ParseInt(tokenID, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid token_id %q: %w", tokenID, err)
	}
	return id, nil
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
	id, err := strconv.ParseInt(*sessionID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid session id %q: %w", *sessionID, err)
	}
	return id, nil
}

func tokenExpiresAtArg(expiresAt *time.Time) any {
	if expiresAt == nil {
		return nil
	}
	return *expiresAt
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

// coerceTokenInt64 converts JSON cursor values to INT64 SQL binds.
// Accessors return domain strings so large Spanner IDs survive JSON encoding.
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
				return time.Time{}
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
