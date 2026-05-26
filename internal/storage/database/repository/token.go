package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const (
	tokenPGTable = "zitadel_nextgen.tokens"
	tokenSpTable = "tokens"
)

var (
	colTokenPGProjectID     = database.NewColumn(tokenPGTable, "project_id")
	colTokenPGTokenID       = database.NewColumn(tokenPGTable, "token_id")
	colTokenPGUserID        = database.NewColumn(tokenPGTable, "user_id")
	colTokenPGTokenType     = database.NewColumn(tokenPGTable, "token_type")
	colTokenPGSessionID     = database.NewColumn(tokenPGTable, "session_id")
	colTokenPGOIDCSessionID = database.NewColumn(tokenPGTable, "oidc_session_id")
	colTokenPGSAMLSessionID = database.NewColumn(tokenPGTable, "saml_session_id")
	colTokenPGScope         = database.NewColumn(tokenPGTable, "scope")
	colTokenPGExpiresAt     = database.NewColumn(tokenPGTable, "expires_at")
	colTokenPGCreatedAt     = database.NewColumn(tokenPGTable, "created_at")
)

var (
	colTokenSpProjectID     = database.NewColumn(tokenSpTable, "project_id")
	colTokenSpTokenID       = database.NewColumn(tokenSpTable, "token_id")
	colTokenSpUserID        = database.NewColumn(tokenSpTable, "user_id")
	colTokenSpTokenType     = database.NewColumn(tokenSpTable, "token_type")
	colTokenSpSessionID     = database.NewColumn(tokenSpTable, "session_id")
	colTokenSpOIDCSessionID = database.NewColumn(tokenSpTable, "oidc_session_id")
	colTokenSpSAMLSessionID = database.NewColumn(tokenSpTable, "saml_session_id")
	colTokenSpScope         = database.NewColumn(tokenSpTable, "scope")
	colTokenSpExpiresAt     = database.NewColumn(tokenSpTable, "expires_at")
	colTokenSpCreatedAt     = database.NewColumn(tokenSpTable, "created_at")
)

type tokenTableCols struct {
	projectID, tokenID, userID, tokenType database.Column
	sessionID, oidcSessionID, samlSessionID database.Column
	scope, expiresAt, createdAt           database.Column
}

type TokenRepository struct {
	table         string
	encodeScope   func([]string) any
	now           database.Instruction
	tokenTypeCast string // e.g. "::zitadel_nextgen.token_types" for Postgres; empty for Spanner
}

func NewTokenRepository(client database.QueryExecutor) *TokenRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return newTokenRepository(tokenSpTable, func(s []string) any { return s }, database.CurrentTimestampInstruction, "")
	case postgres.PostgresPooler:
		return newTokenRepository(tokenPGTable, func(s []string) any { return StringArray(s) }, database.NowInstruction, "::zitadel_nextgen.token_types")
	}
	panic("NewTokenRepository: unsupported client type")
}

func newTokenRepository(table string, encodeScope func([]string) any, now database.Instruction, tokenTypeCast string) *TokenRepository {
	return &TokenRepository{table: table, encodeScope: encodeScope, now: now, tokenTypeCast: tokenTypeCast}
}

func (r *TokenRepository) qualifiedTableName() string { return r.table }

func (r *TokenRepository) cols() tokenTableCols {
	if r.table == tokenPGTable {
		return tokenTableCols{
			projectID: colTokenPGProjectID, tokenID: colTokenPGTokenID, userID: colTokenPGUserID,
			tokenType: colTokenPGTokenType,
			sessionID: colTokenPGSessionID, oidcSessionID: colTokenPGOIDCSessionID, samlSessionID: colTokenPGSAMLSessionID,
			scope: colTokenPGScope, expiresAt: colTokenPGExpiresAt, createdAt: colTokenPGCreatedAt,
		}
	}
	return tokenTableCols{
		projectID: colTokenSpProjectID, tokenID: colTokenSpTokenID, userID: colTokenSpUserID,
		tokenType: colTokenSpTokenType,
		sessionID: colTokenSpSessionID, oidcSessionID: colTokenSpOIDCSessionID, samlSessionID: colTokenSpSAMLSessionID,
		scope: colTokenSpScope, expiresAt: colTokenSpExpiresAt, createdAt: colTokenSpCreatedAt,
	}
}

func (r *TokenRepository) selectColumns() database.Columns {
	c := r.cols()
	return database.Columns{
		c.projectID, c.tokenID, c.userID, c.tokenType,
		c.sessionID, c.oidcSessionID, c.samlSessionID,
		c.scope, c.expiresAt, c.createdAt,
	}
}

func (r *TokenRepository) PrimaryKeyColumns() []database.Column {
	c := r.cols()
	return []database.Column{c.projectID, c.tokenID}
}

func (r *TokenRepository) PrimaryKeyCondition(projectID, tokenID string) database.Condition {
	return database.And(
		r.ProjectIDCondition(projectID),
		r.TokenIDCondition(tokenID),
	)
}

func (r *TokenRepository) ProjectIDCondition(projectID string) database.Condition {
	return database.NewTextCondition(r.cols().projectID, database.TextOperationEqual, projectID)
}

func (r *TokenRepository) TokenIDCondition(tokenID string) database.Condition {
	return database.NewIdentityEqualCondition(r.cols().tokenID, tokenID)
}

func (r *TokenRepository) UserIDCondition(userID string) database.Condition {
	return database.NewTextCondition(r.cols().userID, database.TextOperationEqual, userID)
}

func (r *TokenRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.Token, error) {
	builder := database.NewStatementBuilder("SELECT ")
	r.selectColumns().WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	queryOpts := new(database.QueryOpts)
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)

	row, err := getOne[tokenRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *TokenRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.Token, error) {
	builder := database.NewStatementBuilder("SELECT ")
	r.selectColumns().WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	queryOpts := new(database.QueryOpts)
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)

	rows, err := getMany[tokenRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.Token, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *TokenRepository) Create(ctx context.Context, client database.QueryExecutor, token *domain.Token) error {
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

	expiresArg := any(database.NullInstruction)
	if token.ExpiresAt != nil {
		expiresArg = *token.ExpiresAt
	}

	c := r.cols()
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(" (")
	database.Columns{
		c.projectID, c.userID, c.tokenType,
		c.sessionID, c.oidcSessionID, c.samlSessionID,
		c.scope, c.expiresAt, c.createdAt,
	}.WriteUnqualified(builder)
	builder.WriteString(") VALUES (")
	builder.WriteArgs(token.ProjectID, token.UserID)
	builder.WriteString(", ")
	builder.WriteString(builder.AppendArg(token.Type.String()) + r.tokenTypeCast)
	builder.WriteString(", ")
	builder.WriteArgs(
		sessionIDArg(token.SessionID),
		sessionIDArg(token.OIDCSessionID),
		sessionIDArg(token.SAMLSessionID),
		r.encodeScope(scope),
		expiresArg,
		r.now,
	)
	if r.table == tokenSpTable {
		builder.WriteString(") THEN RETURN ")
	} else {
		builder.WriteString(") RETURNING ")
	}
	c.tokenID.WriteUnqualified(builder)

	var tokenID database.Identity
	if err := client.QueryRow(ctx, builder.String(), builder.Args()...).Scan(&tokenID); err != nil {
		return err
	}
	if tokenID == "" {
		return fmt.Errorf("failed to create token: no token_id returned")
	}
	token.TokenID = tokenID.String()
	return nil
}

func (r *TokenRepository) Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error {
	_, err := deleteOne(ctx, client, r, condition)
	return err
}

type tokenRow struct {
	ProjectID     string             `db:"project_id"`
	TokenID       database.Identity  `db:"token_id"`
	UserID        string             `db:"user_id"`
	Type          domain.TokenType   `db:"token_type"`
	SessionID     sql.NullInt64      `db:"session_id"`
	OIDCSessionID sql.NullInt64      `db:"oidc_session_id"`
	SAMLSessionID sql.NullInt64      `db:"saml_session_id"`
	Scope         StringArray        `db:"scope"`
	ExpiresAt     sql.NullTime       `db:"expires_at"`
	CreatedAt     time.Time          `db:"created_at"`
}

func (r *tokenRow) toDomain() *domain.Token {
	t := &domain.Token{
		ProjectID: r.ProjectID,
		TokenID:   r.TokenID.String(),
		UserID:    r.UserID,
		Type:      r.Type,
		CreatedAt: r.CreatedAt,
	}
	if len(r.Scope) > 0 {
		t.Scope = []string(r.Scope)
	} else {
		t.Scope = []string{}
	}
	if r.SessionID.Valid {
		s := strconv.FormatInt(r.SessionID.Int64, 10)
		t.SessionID = &s
	}
	if r.OIDCSessionID.Valid {
		s := strconv.FormatInt(r.OIDCSessionID.Int64, 10)
		t.OIDCSessionID = &s
	}
	if r.SAMLSessionID.Valid {
		s := strconv.FormatInt(r.SAMLSessionID.Int64, 10)
		t.SAMLSessionID = &s
	}
	if r.ExpiresAt.Valid {
		exp := r.ExpiresAt.Time
		t.ExpiresAt = &exp
	}
	return t
}

var _ domain.TokenRepository = (*TokenRepository)(nil)
