package users

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Import loads bootstrap users from JSON files into the database.
// dialect is the configured database dialect name (e.g. "postgres"); used to reject unsupported backends.
func Import(ctx context.Context, v2Pool service.StatementPool, hashValidator crypto.HashValidator, dialect string, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	if err := checkDialectSupported(dialect); err != nil {
		return err
	}

	for _, path := range paths {
		if err := importFile(ctx, v2Pool, hashValidator, path); err != nil {
			return fmt.Errorf("user file %q: %w", path, err)
		}
	}
	return nil
}

func importFile(
	ctx context.Context,
	v2Pool service.StatementPool,
	hashValidator crypto.HashValidator,
	path string,
) error {
	doc, err := ParseFile(path)
	if err != nil {
		return err
	}
	if err := Validate(doc, hashValidator); err != nil {
		return err
	}
	pw, err := parsePasswordAuthenticator(doc.Authenticators)
	if err != nil {
		return err
	}

	if err := ensureDependencies(ctx, v2Pool.Statements(), doc.Header); err != nil {
		return err
	}

	_, err = v2Pool.Statements().GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), doc.Header.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), doc.Header.ID),
	), service.UserQueryOptions{})
	if err == nil {
		slog.Info("bootstrap user: skipped user because they already exists)", slog.String("path", path), slog.String("id", doc.Header.ID))
		return nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return fmt.Errorf("check existing user: %w", err)
	}

	attrs, err := buildCreateAttributes(doc.Attributes)
	if err != nil {
		return err
	}

	var participationTeamID *string
	if doc.Header.TeamID != "" {
		tid := doc.Header.TeamID
		participationTeamID = &tid
	}

	if err := v2Pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		if err := tx.Statements().CreateUser(ctx, &domain.CreateUser{
			ProjectID:               doc.Header.ProjectID,
			SchemaURL:               doc.Header.SchemaURL,
			ID:                      doc.Header.ID,
			InitialMembershipTeamID: participationTeamID,
			Attributes:              attrs,
		}); err != nil {
			return fmt.Errorf("create user: %w", err)
		}
		if err := tx.Statements().SetUserPassword(ctx, &domain.SetUserPassword{
			ProjectID:      doc.Header.ProjectID,
			UserID:         doc.Header.ID,
			EncodedHash:    pw.EncodedHash,
			ChangeRequired: pw.ChangeRequired,
		}); err != nil {
			return fmt.Errorf("set password: %w", err)
		}
		return nil
	}); err != nil {
		return err
	}

	slog.Info("bootstrap user: loaded user", slog.String("path", path), slog.String("id", doc.Header.ID))

	return nil
}

func buildCreateAttributes(attrs map[domain.AttributeKey]json.RawMessage) (domain.CreateAttributes, error) {
	out := make(domain.CreateAttributes, 0, len(attrs))
	for key, raw := range attrs {
		value, err := decodeScalar(raw, key)
		if err != nil {
			return nil, err
		}
		scope := domain.AttributeUniquenessUnspecified
		if key == attrKeyUsername {
			scope = domain.AttributeUniquenessProject
		}
		attr, err := domain.NewCreateAttribute(key, value, scope)
		if err != nil {
			return nil, fmt.Errorf("attribute %q: %w", key, err)
		}
		out = append(out, *attr)
	}
	return out, nil
}

// DialectFromConfig returns the sole configured database dialect name, or "" if unset.
func DialectFromConfig(raw map[string]any) string {
	for name := range raw {
		return name
	}
	return ""
}
