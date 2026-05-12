package repository

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type userLiteralAlwaysTrue struct{}

func (userLiteralAlwaysTrue) Write(b *database.StatementBuilder) { b.WriteString("TRUE") }

func (userLiteralAlwaysTrue) Matches(any) bool { return true }

func (userLiteralAlwaysTrue) String() string { return "userLiteralAlwaysTrue" }

func (userLiteralAlwaysTrue) IsRestrictingColumn(database.Column) bool { return false }

var _ database.Condition = userLiteralAlwaysTrue{}

type userUnsupportedChange struct {
	column database.Column
	err    error
}

func (c userUnsupportedChange) Matches(any) bool { return true }

func (c userUnsupportedChange) String() string { return "userUnsupportedChange" }

func (c userUnsupportedChange) WriteArg(*database.StatementBuilder) {}

func (c userUnsupportedChange) Write(*database.StatementBuilder) error { return c.err }

func (c userUnsupportedChange) IsOnColumn(col database.Column) bool {
	return c.column.Equals(col)
}

var _ database.Change = userUnsupportedChange{}

func uniquenessScopeLiteral(scope domain.AttributeUniqueness) string {
	switch scope {
	case domain.AttributeUniquenessUnspecified:
		return "unspecified"
	case domain.AttributeUniquenessTeam:
		return "team"
	case domain.AttributeUniquenessGlobal:
		return "global"
	default:
		return "unspecified"
	}
}

func coerceNoRows(err error) error {
	if err != nil {
		return err
	}
	return database.NewNoRowFoundError(nil)
}

type userAuthPresence struct {
	hasPassword bool
	hasTOTP     bool
	hasRC       bool
	hasPasskeys bool
	hasPATs     bool
}

func scanUserHydrationRowParts(rows database.Rows) (*domain.User, userAuthPresence, error) {
	var (
		projectID string
		schemaURL string
		id        string
		team      database.Null[string]
		createdAt time.Time
		updatedAt time.Time
		attrJSON  []byte
		flags     userAuthPresence
	)
	if err := rows.Scan(
		&projectID,
		&schemaURL,
		&id,
		&team,
		&createdAt,
		&updatedAt,
		&attrJSON,
		&flags.hasPassword,
		&flags.hasTOTP,
		&flags.hasRC,
		&flags.hasPasskeys,
		&flags.hasPATs,
	); err != nil {
		return nil, flags, err
	}

	u := &domain.User{
		ProjectID: projectID,
		SchemaURL: schemaURL,
		ID:        id,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
	if team.Valid {
		copy := team.V
		u.TeamID = &copy
	}

	raw := attrJSON
	if len(raw) == 0 {
		raw = []byte(`[]`)
	}
	type kv struct {
		Key   string          `json:"key"`
		Value json.RawMessage `json:"value"`
	}
	var kvs []kv
	if err := json.Unmarshal(raw, &kvs); err != nil {
		return nil, flags, fmt.Errorf("decode attributes json: %w", err)
	}
	for _, row := range kvs {
		var val any
		if err := json.Unmarshal(row.Value, &val); err != nil {
			return nil, flags, fmt.Errorf("decode attribute value for %q: %w", row.Key, err)
		}
		u.Attributes = append(u.Attributes, domain.Attribute{Key: row.Key, Value: val})
	}
	return u, flags, nil
}

func applyAuthMethods(u *domain.User, withAuth bool, flags userAuthPresence) *domain.User {
	if !withAuth {
		u.AvailableAuthMethods = nil
		return u
	}
	u.AvailableAuthMethods = authMethodsFromFlags(flags)
	return u
}

func authMethodsFromFlags(f userAuthPresence) []domain.AuthMethod {
	out := make([]domain.AuthMethod, 0, 5)
	if f.hasPassword {
		out = append(out, domain.AuthMethodPassword)
	}
	if f.hasPasskeys {
		out = append(out, domain.AuthMethodPasskey)
	}
	if f.hasTOTP {
		out = append(out, domain.AuthMethodTOTP)
	}
	if f.hasRC {
		out = append(out, domain.AuthMethodRecoveryCodes)
	}
	_ = f.hasPATs // PATs are not part of [domain.AuthMethod] today.
	return out
}
