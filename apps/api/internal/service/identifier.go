package service

import (
	"context"
	"errors"
	"log/slog"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// errIdentifierUnresolved means a value identifies no user, or more than one.
// The two are reported alike on purpose: a caller must not be able to learn
// which from the outcome.
var errIdentifierUnresolved = errors.New("identifier unresolved")

// resolveDesignatedUser resolves a bare identifier value against the
// designated identifier (`x-identifier`) of every user schema in the project.
// Each designated property is looked up among the users of the schemas that
// designate it and among uniquely registered values only, so an equal value in
// an undesignated or non-unique property never matches. The value must
// identify exactly one user; none, or several, is errIdentifierUnresolved —
// never resolved by precedence between schemas. activeOnly restricts the match
// to active users; each caller passes it explicitly, since whether an inactive
// user can be reached by identifier is decided per surface. area names the log
// stream the unresolved outcomes are recorded under.
func resolveDesignatedUser(ctx context.Context, stmts AllStatements, projectID, value string, activeOnly bool, area string) (*domain.User, error) {
	urlsByKey, err := designatedIdentifierKeys(ctx, stmts, projectID)
	if err != nil {
		return nil, err
	}
	found := map[string]struct{}{}
	var match *domain.User
	for key, urls := range urlsByKey {
		filters := []database.Filter[domain.UserField]{
			database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			database.Or(equalIDFilters(domain.UserFieldSchemaURL, urls)...),
		}
		if activeOnly {
			filters = append(filters, database.Equal(database.Col(domain.UserFieldStatus), domain.UserStatusActive.String()))
		}
		user, err := stmts.GetUser(ctx, database.And(filters...), UserQueryOptions{
			Attributes:           []domain.Attribute{{Key: domain.AttributeKey(key), Value: value}},
			UniqueAttributesOnly: true,
		})
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			if _, ok := errors.AsType[*database.MultipleRowsFoundError](err); ok {
				getLoggingContext(ctx, area).Info("identifier lookup is ambiguous",
					slog.String("project_id", projectID),
					slog.String("identifier_property", key),
				)
				return nil, errIdentifierUnresolved
			}
			return nil, err
		}
		found[user.ID] = struct{}{}
		match = user
	}
	if len(found) != 1 {
		if len(found) > 1 {
			getLoggingContext(ctx, area).Info("identifier lookup matched multiple users",
				slog.String("project_id", projectID),
				slog.Int("matches", len(found)),
			)
		} else {
			getLoggingContext(ctx, area).Info("identifier lookup matched no user",
				slog.String("project_id", projectID),
			)
		}
		return nil, errIdentifierUnresolved
	}
	return match, nil
}

// designatedIdentifierKeys maps each x-identifier property to the schema URLs
// that designate it. Lookup must be scoped to those schemas so a unique value
// on a property that is not designated (another schema's notification email,
// for example) cannot be selected. Every stored revision is listed: users keep
// the schema URL they were created under, so each revision's own designation
// governs its users.
func designatedIdentifierKeys(ctx context.Context, stmts AllStatements, projectID string) (map[string][]string, error) {
	// A resolve, not a management list: there may be no signed-in caller whose
	// grants could narrow it (a login has none yet).
	ctx = WithAuthzListUnrestricted(ctx)
	list := listUserSchemas(ctx, stmts, projectID)
	first, err := list(nil)
	if err != nil {
		return nil, err
	}
	urlsByKey := map[string][]string{}
	for schema, err := range first.Iterate(list) {
		if err != nil {
			return nil, err
		}
		key := domain.DesignatedIdentifier(schema.Schema)
		if key == "" || schema.URL == "" {
			continue
		}
		urlsByKey[key] = append(urlsByKey[key], schema.URL)
	}
	return urlsByKey, nil
}

// designatedSearchKeys are the properties any user schema revision of the
// project designates as identifier or display part: the keys whose attributes
// carry search text (ADR 058). perUser is the most of them one schema
// designates, so the most ways one user can match a search over all of them.
func designatedSearchKeys(ctx context.Context, stmts AllStatements, projectID string) (keys []domain.AttributeKey, perUser int, err error) {
	// As in designatedIdentifierKeys: every revision's designation counts,
	// whatever the caller's grants cover.
	ctx = WithAuthzListUnrestricted(ctx)
	list := listUserSchemas(ctx, stmts, projectID)
	first, err := list(nil)
	if err != nil {
		return nil, 0, err
	}
	for schema, err := range first.Iterate(list) {
		if err != nil {
			return nil, 0, err
		}
		var designated []domain.AttributeKey
		if identifier := domain.DesignatedIdentifier(schema.Schema); identifier != "" {
			designated = append(designated, domain.AttributeKey(identifier))
		}
		for _, part := range domain.DesignatedDisplay(schema.Schema) {
			if part != "" {
				designated = append(designated, domain.AttributeKey(part))
			}
		}
		slices.Sort(designated)
		designated = slices.Compact(designated)
		perUser = max(perUser, len(designated))
		keys = append(keys, designated...)
	}
	slices.Sort(keys)
	return slices.Compact(keys), perUser, nil
}
