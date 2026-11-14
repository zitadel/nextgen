package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestSearchEntryTexts(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		names []string
		want  []domain.SearchEntryText
	}{
		{
			name:  "a name and its later words",
			names: []string{"Partner Staff"},
			want: []domain.SearchEntryText{
				{Text: "partner staff", NameStart: true},
				{Text: "staff"},
			},
		},
		{
			name:  "a word starts at a letter or digit after anything else",
			names: []string{"100% Remote", "partner-sso"},
			want: []domain.SearchEntryText{
				{Text: "100% remote", NameStart: true},
				{Text: "partner-sso", NameStart: true},
				{Text: "remote"},
				{Text: "sso"},
			},
		},
		{
			name:  "a text two names share is a name start when either is",
			names: []string{"Staff", "Partner Staff"},
			want: []domain.SearchEntryText{
				{Text: "partner staff", NameStart: true},
				{Text: "staff", NameStart: true},
			},
		},
		{
			name:  "an empty name adds nothing",
			names: []string{""},
			want:  []domain.SearchEntryText{},
		},
		{
			name:  "case folds as uniqueness does",
			names: []string{"Straße"},
			want:  []domain.SearchEntryText{{Text: "strasse", NameStart: true}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, domain.SearchEntry{Names: tt.names}.Texts())
		})
	}

	t.Run("words past the cap are not indexed", func(t *testing.T) {
		t.Parallel()
		texts := domain.SearchEntry{Names: []string{strings.Repeat("w ", 20)}}.Texts()
		assert.Len(t, texts, 1+domain.SearchEntryWordsPerName)
	})
}

func TestSearchEntries(t *testing.T) {
	t.Parallel()

	t.Run("a schema is titled by its title, its object type beneath", func(t *testing.T) {
		t.Parallel()
		objectType := "partner-user"
		entry, ok := domain.SchemaSearchEntry(&domain.JSONSchema{
			ProjectID:  "proj_1",
			URL:        "sch_1",
			ObjectType: &objectType,
			Kind:       domain.JSONSchemaKindUserSchema,
			Schema:     []byte(`{"title":"Partner Staff"}`),
		})
		assert.True(t, ok)
		assert.Equal(t, domain.SearchEntry{
			ProjectID:  "proj_1",
			Kind:       domain.ResourceKindSchema,
			Key:        "partner-user",
			ResourceID: "sch_1",
			Title:      "Partner Staff",
			Subtitle:   "partner-user",
			Names:      []string{"Partner Staff", "partner-user"},
		}, entry)
	})

	t.Run("a schema that is not a user schema is not found", func(t *testing.T) {
		t.Parallel()
		_, ok := domain.SchemaSearchEntry(&domain.JSONSchema{URL: "sch_1", Schema: []byte(`{}`)})
		assert.False(t, ok)
	})

	t.Run("a connection is titled by its display name, its slug beneath", func(t *testing.T) {
		t.Parallel()
		entry := domain.IDPConnectionSearchEntry(&domain.IDPConnection{
			ProjectID: "proj_1",
			ID:        "idp_1",
			Slug:      "partner-sso",
			Document:  []byte(`{"display_name":"Partner Portal"}`),
		})
		assert.Equal(t, "Partner Portal", entry.Title)
		assert.Equal(t, "partner-sso", entry.Subtitle)

		entry = domain.IDPConnectionSearchEntry(&domain.IDPConnection{Slug: "partner-sso", Document: []byte(`{`)})
		assert.Equal(t, "partner-sso", entry.Title)
		assert.Empty(t, entry.Subtitle)
	})

	t.Run("a flow definition carries the purposes it handles", func(t *testing.T) {
		t.Parallel()
		entry := domain.FlowDefinitionSearchEntry(&domain.FlowDefinition{
			ProjectID: "proj_1",
			ID:        "flowdef_1",
			Name:      "partner-sign-in",
			Purposes: map[domain.FlowDefinitionPurpose]string{
				domain.FlowDefinitionPurposeRegister: "a",
				domain.FlowDefinitionPurposeLogin:    "b",
			},
		})
		assert.Equal(t, "partner-sign-in", entry.Key)
		assert.Equal(t, "login, register", entry.Subtitle)
	})
}

func TestSearchEntryMatchRank(t *testing.T) {
	t.Parallel()
	assert.Equal(t, domain.SearchRankWhole, domain.SearchEntryMatch{MatchedText: "annex", NameStart: true}.Rank("annex"))
	assert.Equal(t, domain.SearchRankPrefix, domain.SearchEntryMatch{MatchedText: "annex", NameStart: true}.Rank("ann"))
	assert.Equal(t, domain.SearchRankContains, domain.SearchEntryMatch{MatchedText: "staff"}.Rank("staff"))
}
