package repository

import (
	"context"
	"database/sql"
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
	return database.NewTextCondition(r.cols().tokenID, database.TextOperationEqual, tokenID)
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

	scope := token.Scope
	if scope == nil {
		scope = []string{}
	}

	sessionArg := optionalStringArg(token.SessionID)
	oidcSessionArg := optionalStringArg(token.OIDCSessionID)
	samlSessionArg := optionalStringArg(token.SAMLSessionID)
	expiresArg := any(database.NullInstruction)
	if token.ExpiresAt != nil {
		expiresArg = *token.ExpiresAt
	}

	c := r.cols()
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(" (")
	database.Columns{
		c.projectID, c.tokenID, c.userID, c.tokenType,
		c.sessionID, c.oidcSessionID, c.samlSessionID,
		c.scope, c.expiresAt, c.createdAt,
	}.WriteUnqualified(builder)
	builder.WriteString(") VALUES (")
	builder.WriteArgs(token.ProjectID, token.TokenID, token.UserID)
	builder.WriteString(", ")
	builder.WriteString(builder.AppendArg(token.Type.String()) + r.tokenTypeCast)
	builder.WriteString(", ")
	builder.WriteArgs(sessionArg, oidcSessionArg, samlSessionArg, r.encodeScope(scope), expiresArg, r.now)
	builder.WriteString(")")
	_, err := client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func optionalStringArg(s *string) any {
	if s == nil {
		return database.NullInstruction
	}
	return *s
}

func (r *TokenRepository) Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error {
	_, err := deleteOne(ctx, client, r, condition)
	return err
}

type tokenRow struct {
	ProjectID     string           `db:"project_id"`
	TokenID       string           `db:"token_id"`
	UserID        string           `db:"user_id"`
	Type          domain.TokenType `db:"token_type"`
	SessionID     sql.NullString   `db:"session_id"`
	OIDCSessionID sql.NullString   `db:"oidc_session_id"`
	SAMLSessionID sql.NullString   `db:"saml_session_id"`
	Scope         []string         `db:"scope"`
	ExpiresAt     sql.NullTime     `db:"expires_at"`
	CreatedAt     time.Time        `db:"created_at"`
}

func (r *tokenRow) toDomain() *domain.Token {
	t := &domain.Token{
		ProjectID: r.ProjectID,
		TokenID:   r.TokenID,
		UserID:    r.UserID,
		Type:      r.Type,
		CreatedAt: r.CreatedAt,
	}
	if r.Scope != nil {
		t.Scope = r.Scope
	} else {
		t.Scope = []string{}
	}
	if r.SessionID.Valid {
		s := r.SessionID.String
		t.SessionID = &s
	}
	if r.OIDCSessionID.Valid {
		s := r.OIDCSessionID.String
		t.OIDCSessionID = &s
	}
	if r.SAMLSessionID.Valid {
		s := r.SAMLSessionID.String
		t.SAMLSessionID = &s
	}
	if r.ExpiresAt.Valid {
		exp := r.ExpiresAt.Time
		t.ExpiresAt = &exp
	}
	return t
}

var _ domain.TokenRepository = (*TokenRepository)(nil)
