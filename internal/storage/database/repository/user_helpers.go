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

type userAttributeMatch struct {
	key   string
	value any
}

func (c userAttributeMatch) Write(b *database.StatementBuilder) {
	raw, err := json.Marshal(c.value)
	if err != nil {
		b.WriteString("FALSE")
		return
	}
	colUserAttributeProjectID.WriteQualified(b)
	b.WriteString(" = ")
	colUserProjectID.WriteQualified(b)
	b.WriteString(" AND ")
	colUserAttributeUserID.WriteQualified(b)
	b.WriteString(" = ")
	colUserID.WriteQualified(b)
	b.WriteString(" AND ")
	colUserAttributeKey.WriteQualified(b)
	b.WriteString(" = ")
	b.WriteArg(c.key)
	b.WriteString(" AND ")
	colUserAttributeValue.WriteQualified(b)
	b.WriteString(" = ")
	b.WriteArg(string(raw))
	b.WriteString("::jsonb AND jsonb_typeof(")
	colUserAttributeValue.WriteQualified(b)
	b.WriteString(") IN ('string','number','boolean')")
}

func (userAttributeMatch) Matches(any) bool { return true }

func (userAttributeMatch) String() string { return "userAttributeMatch" }

func (userAttributeMatch) IsRestrictingColumn(database.Column) bool { return false }

var _ database.Condition = userAttributeMatch{}

func uniquenessScopeLiteral(scope domain.AttributeUniqueness) string {
	switch scope {
	case domain.AttributeUniquenessUnspecified:
		return "unspecified"
	case domain.AttributeUniquenessTeam:
		return "team"
	case domain.AttributeUniquenessProject:
		return "project"
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
}

func scanUserHydrationRowParts(rows database.Rows) (*domain.User, userAuthPresence, error) {
	var (
		projectID string
		schemaURL string
		id        string
		team      database.Null[string]
		createdAt time.Time
		updatedAt time.Time
		attrKeys  []string
		attrVals  [][]byte
		flags     userAuthPresence
	)
	if err := rows.Scan(
		&projectID,
		&schemaURL,
		&id,
		&team,
		&createdAt,
		&updatedAt,
		&attrKeys,
		&attrVals,
		&flags.hasPassword,
		&flags.hasTOTP,
		&flags.hasRC,
		&flags.hasPasskeys,
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

	if len(attrKeys) != len(attrVals) {
		return nil, flags, fmt.Errorf("attribute key/value length mismatch: %d keys, %d values", len(attrKeys), len(attrVals))
	}
	for i, k := range attrKeys {
		var val any
		if err := json.Unmarshal(attrVals[i], &val); err != nil {
			return nil, flags, fmt.Errorf("decode attribute value for %q: %w", k, err)
		}
		u.Attributes = append(u.Attributes, domain.Attribute{Key: k, Value: val})
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
	out := make([]domain.AuthMethod, 0, 4)
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
	return out
}
