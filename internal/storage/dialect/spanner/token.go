package spanner

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	tokensTable     = "tokens"
	createTokenStmt = `INSERT INTO tokens (
	project_id, token_id, user_id, token_type,
	session_id, oidc_session_id, saml_session_id,
	scope, expires_at
) VALUES (
	@p1, @p2, @p3, @p4,
	@p5, @p6, @p7,
	@p8, @p9
) THEN RETURN created_at`
	deleteByIDTokenStmt        = `DELETE FROM tokens WHERE project_id = @p1 AND token_id = @p2`
	deleteBySessionIDTokenStmt = `DELETE FROM tokens WHERE project_id = @p1 AND session_id = @p2`
	tokenQuery                 = `SELECT project_id, token_id, user_id, token_type,
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
	if err := ensureManagedID(&token.TokenID, domain.TokenPrefix); err != nil {
		return err
	}

	scope := token.Scope
	if scope == nil {
		scope = []string{}
	}

	stmt := buildStatement(createTokenStmt,
		token.ProjectID,
		token.TokenID,
		tokenUserIDArg(token.UserID, token.Type),
		token.Type.String(),
		tokenSessionIDArg(token.SessionID),
		tokenSessionIDArg(token.OIDCSessionID),
		tokenSessionIDArg(token.SAMLSessionID),
		scope,
		tokenExpiresAtArg(token.ExpiresAt),
	).statement()

	err := ts.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&token.CreatedAt)
		})
		return err
	})
	return err
}

// DeleteTokenByID implements [service.TokenStatements].
func (ts tokenStatements) DeleteTokenByID(ctx context.Context, projectID, tokenID string) error {
	stmt := buildStatement(deleteByIDTokenStmt, projectID, tokenID).statement()
	_, err := ts.db.Update(ctx, stmt)
	return err
}

// GetTokenByID implements [service.TokenStatements].
func (ts tokenStatements) GetTokenByID(ctx context.Context, projectID, tokenID string) (*domain.Token, error) {
	row, err := ts.db.ReadRow(ctx, tokensTable, spanner.Key{projectID, tokenID}, tokenColumns)
	if err != nil {
		return nil, err
	}
	return ts.scanToken(row)
}

// DeleteTokensBySessionID implements [service.TokenStatements].
func (ts tokenStatements) DeleteTokensBySessionID(ctx context.Context, projectID, sessionID string) error {
	_, err := ts.db.Update(ctx, buildStatement(deleteBySessionIDTokenStmt, projectID, sessionID).statement())
	return err
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
		userID                           spanner.NullString
		sessionID, oidcSessionID, samlID spanner.NullString
		scope                            []string
		expiresAt                        spanner.NullTime
		tokenType                        string
	)
	if err := row.Columns(
		&token.ProjectID,
		&token.TokenID,
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
	if err := token.Type.Scan(tokenType); err != nil {
		return nil, err
	}
	if userID.Valid {
		token.UserID = userID.StringVal
	}
	if sessionID.Valid {
		s := sessionID.StringVal
		token.SessionID = &s
	}
	if oidcSessionID.Valid {
		s := oidcSessionID.StringVal
		token.OIDCSessionID = &s
	}
	if samlID.Valid {
		s := samlID.StringVal
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

// tokenUserIDArg keeps an absent user NULL rather than "": the column carries a
// foreign key to users, and project credentials authenticate software, not a
// user, so they have none at all.
func tokenUserIDArg(userID string, _ domain.TokenType) any {
	if userID == "" {
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
		Coerce:   database.CoerceString,
	},
	domain.TokenFieldOIDCSessionID: {
		SQLName:  "oidc_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.OIDCSessionID) },
		Coerce:   database.CoerceString,
	},
	domain.TokenFieldSAMLSessionID: {
		SQLName:  "saml_session_id",
		Accessor: func(t *domain.Token) any { return tokenOptionalString(t.SAMLSessionID) },
		Coerce:   database.CoerceString,
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
