package domain

import (
	"cmp"
	"slices"
	"strings"
	"unicode"
)

// SearchEntry is what search finds a team, a user schema, a flow definition or
// an identity provider connection by (ADR 087 §5): the names a person knows it
// by, and the reference a search answers with. The storage writes it in the
// transaction that writes the resource, one row per text of
// [SearchEntry.Texts], so a search reads one range of one index whatever the
// size of the project.
type SearchEntry struct {
	ProjectID string
	Kind      ResourceKind
	// Key is what a newer revision replaces the entry by: the id of a team and
	// of a connection, the object type of a schema, the name of a flow
	// definition. An entry always answers with the newest revision of its key.
	Key string
	// ResourceID is the id a search result carries.
	ResourceID string
	Title      string
	Subtitle   string
	// Names are the values the resource is matched on, as written.
	Names []string
}

// SearchEntryText is one text of a [SearchEntry] a search compares the start
// of.
type SearchEntryText struct {
	// Text is a name as [SearchText] folds it, or its tail from one of its
	// words on.
	Text string
	// NameStart says the text is a whole name, not the tail from a later word.
	NameStart bool
}

// SearchEntryWordsPerName caps how many words of one name a search finds it
// by, besides the start of the name: each is a row, and a name is at most a
// few hundred characters.
const SearchEntryWordsPerName = 8

// Texts are the texts the entry is found by: each name folded, then its tail
// from each later word, so "Partner Staff" is found by "part" and by "sta". A
// word starts at a letter or digit after a character that is neither, so
// "partner-sso" is found by "sso" and "100% Remote" by "rem", not by "%". Each
// text is cut to [SearchTextMaxRunes]. Texts repeated across names appear once,
// as a name start when any of them is one.
func (e SearchEntry) Texts() []SearchEntryText {
	byText := make(map[string]bool)
	for _, name := range e.Names {
		folded, ok := SearchText(name)
		if !ok {
			continue
		}
		byText[folded] = true
		words := 0
		var previous rune
		for offset, r := range folded {
			if offset > 0 && isSearchWordRune(r) && !isSearchWordRune(previous) {
				if words == SearchEntryWordsPerName {
					break
				}
				words++
				if _, seen := byText[folded[offset:]]; !seen {
					byText[folded[offset:]] = false
				}
			}
			previous = r
		}
	}
	texts := make([]SearchEntryText, 0, len(byText))
	for text, nameStart := range byText {
		texts = append(texts, SearchEntryText{Text: text, NameStart: nameStart})
	}
	slices.SortFunc(texts, func(a, b SearchEntryText) int { return cmp.Compare(a.Text, b.Text) })
	return texts
}

func isSearchWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

// TeamSearchEntry is how search finds a team: by its name.
func TeamSearchEntry(team *Team) SearchEntry {
	return SearchEntry{
		ProjectID:  team.ProjectID,
		Kind:       ResourceKindTeam,
		Key:        team.ID,
		ResourceID: team.ID,
		Title:      team.Name,
		Names:      []string{team.Name},
	}
}

// FlowDefinitionSearchEntry is how search finds a flow definition: by its
// name, at its newest revision, with the purposes it handles beneath.
func FlowDefinitionSearchEntry(definition *FlowDefinition) SearchEntry {
	purposes := make([]string, 0, len(definition.Purposes))
	for purpose := range definition.Purposes {
		purposes = append(purposes, purpose.String())
	}
	slices.Sort(purposes)
	return SearchEntry{
		ProjectID:  definition.ProjectID,
		Kind:       ResourceKindFlowDefinition,
		Key:        definition.Name,
		ResourceID: definition.ID,
		Title:      definition.Name,
		Subtitle:   strings.Join(purposes, ", "),
		Names:      []string{definition.Name},
	}
}

// SchemaSearchEntry is how search finds a user schema: by its title and its
// object type, at its newest revision. The bool is false for a schema search
// does not find, one that is not a user schema.
func SchemaSearchEntry(schema *JSONSchema) (SearchEntry, bool) {
	if schema.Kind != JSONSchemaKindUserSchema {
		return SearchEntry{}, false
	}
	var objectType string
	if schema.ObjectType != nil {
		objectType = *schema.ObjectType
	}
	// A schema without an object type is a revision of nothing, so it stands
	// alone under its own id.
	key := cmp.Or(objectType, schema.URL)
	title := schema.Title()
	entry := SearchEntry{
		ProjectID:  schema.ProjectID,
		Kind:       ResourceKindSchema,
		Key:        key,
		ResourceID: schema.URL,
		Title:      cmp.Or(title, objectType, schema.URL),
		Names:      []string{title, objectType},
	}
	if title != "" && objectType != title {
		entry.Subtitle = objectType
	}
	return entry, true
}

// IDPConnectionSearchEntry is how search finds an identity provider
// connection: by its slug and by the display name of its newest revision. A
// document that cannot be read still leaves the slug to find it by.
func IDPConnectionSearchEntry(connection *IDPConnection) SearchEntry {
	var displayName string
	if document, err := ParseIDPConnectionDocument(connection.Document); err == nil {
		displayName = document.DisplayName
	}
	entry := SearchEntry{
		ProjectID:  connection.ProjectID,
		Kind:       ResourceKindIDPConnection,
		Key:        connection.ID,
		ResourceID: connection.ID,
		Title:      cmp.Or(displayName, connection.Slug),
		Names:      []string{connection.Slug, displayName},
	}
	if displayName != "" && displayName != connection.Slug {
		entry.Subtitle = connection.Slug
	}
	return entry
}

// SearchEntryMatch is one entry a search read found: the reference, and the
// text of it that matched.
type SearchEntryMatch struct {
	ResourceID  string
	ProjectID   string
	Title       string
	Subtitle    string
	MatchedText string
	NameStart   bool
}

// SearchEntryRange is what one read of a batch found in one project for one
// kind: its matches the caller may see, and whether the range held as many
// rows as the read took, so more may match.
type SearchEntryRange struct {
	ProjectID string
	Kind      ResourceKind
	Matches   []SearchEntryMatch
	Full      bool
}

// Rank is how well the match answers term, the text as [SearchText] folds it:
// a whole name, then the start of a name, then the start of a later word.
func (m SearchEntryMatch) Rank(term string) SearchRank {
	switch {
	case !m.NameStart:
		return SearchRankContains
	case m.MatchedText == term:
		return SearchRankWhole
	default:
		return SearchRankPrefix
	}
}
