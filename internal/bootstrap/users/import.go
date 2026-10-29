package users

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/maputil"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Import loads bootstrap users from JSON files into the database.
// dialect is the configured database dialect name (e.g. "postgres"); used to reject unsupported backends.
// builtinBases maps a document's schema URL onto the row the project stores
// it under when the two name the same built-in under different bases.
func Import(ctx context.Context, v2Pool service.StatementPool, hashValidator crypto.HashValidator, dialect string, builtinBases domain.BuiltinSchemaBases, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	if err := checkDialectSupported(dialect); err != nil {
		return err
	}

	for _, path := range paths {
		if err := importFile(ctx, v2Pool, hashValidator, builtinBases, path); err != nil {
			return fmt.Errorf("user file %q: %w", path, err)
		}
	}
	return nil
}

func importFile(
	ctx context.Context,
	v2Pool service.StatementPool,
	hashValidator crypto.HashValidator,
	builtinBases domain.BuiltinSchemaBases,
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

	// Before the placeholder below can stand in for it: a document naming the
	// default schema under a legacy base meets a project seeded under the
	// current one, and the user must point at the seeded row to sign in.
	doc.Header.SchemaURL, err = storedSchemaURL(ctx, v2Pool.Statements(), builtinBases, doc.Header)
	if err != nil {
		return err
	}

	if err := ensureDependencies(ctx, v2Pool.Statements(), doc.Header); err != nil {
		return err
	}

	exists, err := userExists(ctx, v2Pool.Statements(), doc.Header)
	if err != nil {
		return fmt.Errorf("check existing user: %w", err)
	}
	if exists {
		slog.Info("bootstrap user: skipped user because they already exists)", slog.String("path", path), slog.String("id", doc.Header.ID))
		return nil
	}

	schema, err := loadUserSchema(ctx, v2Pool.Statements(), doc.Header)
	if err != nil {
		return err
	}
	attrs, err := buildCreateAttributes(doc.Attributes, schema, doc.Header.TeamID)
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
			ProjectID:   doc.Header.ProjectID,
			UserID:      doc.Header.ID,
			EncodedHash: pw.EncodedHash,
		}); err != nil {
			return fmt.Errorf("set password: %w", err)
		}
		return nil
	}); err != nil {
		// Several replicas starting at once (a serverless platform brings up
		// one process per request from cold, all reading the same document)
		// can each pass the lookup above and race the insert. A unique
		// violation that left the user in place is the other replica's import
		// of this same document, not a conflict to report; one on another
		// index, with the user still missing, is.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			if exists, checkErr := userExists(ctx, v2Pool.Statements(), doc.Header); checkErr == nil && exists {
				slog.Info("bootstrap user: skipped user because another replica imported them first", slog.String("path", path), slog.String("id", doc.Header.ID))
				return nil
			}
		}
		return err
	}

	slog.Info("bootstrap user: loaded user", slog.String("path", path), slog.String("id", doc.Header.ID))

	return nil
}

// userExists reports whether the document's user is already in the database.
func userExists(ctx context.Context, stmts service.AllStatements, h Header) (bool, error) {
	_, err := stmts.GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), h.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), h.ID),
	), service.UserQueryOptions{})
	if err == nil {
		return true, nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return false, nil
	}
	return false, err
}

// buildCreateAttributes registers each attribute's uniqueness the way user
// creation does (domain.CreateAttributesFromMap): from the property's
// `x-unique` annotation in the user's schema. Without that, a bootstrap user
// whose schema identifies users by `email` cannot be found at sign-in, because
// identifier resolution looks the value up in the unique-attributes registry.
// `username` stays project-unique regardless, as it always was for bootstrap
// users.
func buildCreateAttributes(
	attrs map[domain.AttributeKey]json.RawMessage,
	schema map[string]any,
	teamID string,
) (domain.CreateAttributes, error) {
	out := make(domain.CreateAttributes, 0, len(attrs))
	for key, raw := range attrs {
		value, err := decodeScalar(raw, key)
		if err != nil {
			return nil, err
		}
		scope := uniqueScopeFromSchema(schema, key)
		// A team-scoped attribute on a document with no team would be stored
		// under the empty team, which the users table reads as project-wide:
		// it would claim the value at a scope the schema never asked for, so
		// leave it unregistered instead.
		if scope == domain.AttributeUniquenessTeam && teamID == "" {
			scope = domain.AttributeUniquenessUnspecified
		}
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

// storedSchemaURL returns the URL the project stores the document's schema
// under: the header's own when that row exists or none does, else the URL of
// the row that names the same built-in under another base.
func storedSchemaURL(ctx context.Context, stmts service.AllStatements, builtinBases domain.BuiltinSchemaBases, h Header) (string, error) {
	stored, err := builtinBases.GetJSONSchema(ctx, stmts, h.ProjectID, h.SchemaURL)
	if err == nil {
		return stored.URL, nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return "", fmt.Errorf("look up json_schema %q: %w", h.SchemaURL, err)
	}
	// A project that deployed the default schema stores it under an id the
	// release build minted: the built-in URL names it by its objectType.
	if rel, ok := builtinBases.RelPath(h.SchemaURL); ok && strings.TrimPrefix(rel, "/") == defaultSchemaPath {
		deployed, err := newestSchemaOfType(ctx, stmts, h.ProjectID, defaultSchemaObjectType)
		if err != nil {
			return "", err
		}
		if deployed != nil {
			return deployed.URL, nil
		}
	}
	return h.SchemaURL, nil
}

const (
	// defaultSchemaPath is the default user schema's path under the built-in
	// schema namespace.
	defaultSchemaPath = "default-human-user.json"
	// defaultSchemaObjectType is the objectType that schema declares.
	defaultSchemaObjectType = "human-user"
)

// newestSchemaOfType is the project's newest schema declaring objectType, nil
// when it has none.
func newestSchemaOfType(ctx context.Context, stmts service.AllStatements, projectID, objectType string) (*domain.JSONSchema, error) {
	result, err := stmts.ListJSONSchemas(service.WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(
			database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
			database.Equal(database.Col(domain.JSONSchemaFieldObjectType), objectType),
		),
		Pagination: database.Page[domain.JSONSchemaField]{
			Limit: 1,
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns:   []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldCreatedAt)},
				Direction: database.OrderDesc,
			},
		},
	}, service.JSONSchemaQueryOptions{})
	if err != nil {
		return nil, fmt.Errorf("list %s schemas: %w", objectType, err)
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

// loadUserSchema reads the user's schema document so attribute uniqueness can
// follow its `x-unique` annotations. The row always exists by now:
// ensureDependencies created an empty placeholder when the schema was missing,
// and an empty document simply declares nothing unique.
func loadUserSchema(ctx context.Context, stmts service.AllStatements, h Header) (map[string]any, error) {
	stored, err := stmts.GetJSONSchemaByID(ctx, h.ProjectID, h.SchemaURL)
	if err != nil {
		return nil, fmt.Errorf("load json_schema %q: %w", h.SchemaURL, err)
	}
	schema := map[string]any{}
	if len(stored.Schema) == 0 {
		return schema, nil
	}
	if err := json.Unmarshal(stored.Schema, &schema); err != nil {
		return nil, fmt.Errorf("decode json_schema %q: %w", h.SchemaURL, err)
	}
	return schema, nil
}

// uniqueScopeFromSchema reads a property's `x-unique` annotation and maps it
// through domain.UniqueScopeOf, as domain.CreateAttributesFromMap does.
// Bootstrap attribute keys are flattened dotted paths, so a nested property
// is addressed the way the recursive walk addresses it: every node but the
// last sits behind its own `properties` object.
func uniqueScopeFromSchema(schema map[string]any, key domain.AttributeKey) domain.AttributeUniqueness {
	path := make([]string, 0, len(key.Nodes())*2+1)
	for _, node := range key.Nodes() {
		path = append(path, "properties", node)
	}
	path = append(path, domain.SchemaAnnotationUnique)
	scope, _ := maputil.GetNested[string](schema, path)
	return domain.UniqueScopeOf(scope)
}

// DialectFromConfig returns the sole configured database dialect name, or "" if unset.
func DialectFromConfig(raw map[string]any) string {
	for name := range raw {
		return name
	}
	return ""
}
