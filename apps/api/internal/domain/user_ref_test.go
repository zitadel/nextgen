package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestDesignationReaders(t *testing.T) {
	document := []byte(`{
		"type": "object",
		"x-identifier": "email",
		"x-display": ["givenName", "familyName"]
	}`)
	assert.Equal(t, "email", domain.DesignatedIdentifier(document))
	assert.Equal(t, []string{"givenName", "familyName"}, domain.DesignatedDisplay(document))
	assert.Equal(t, []string{"email", "givenName", "familyName"}, domain.DesignatedAttributeKeys(document))

	undesignated := []byte(`{"type": "object"}`)
	assert.Empty(t, domain.DesignatedIdentifier(undesignated))
	assert.Nil(t, domain.DesignatedDisplay(undesignated))
	assert.Nil(t, domain.DesignatedAttributeKeys(undesignated))

	// Unreadable shapes read as undesignated — validity is enforced at
	// schema creation, not by readers.
	for name, doc := range map[string]string{
		"malformed":             `{`,
		"non-object":            `true`,
		"non-string identifier": `{"x-identifier": ["email"]}`,
		"non-string display":    `{"x-display": ["givenName", 3]}`,
	} {
		t.Run(name, func(t *testing.T) {
			assert.Empty(t, domain.DesignatedIdentifier([]byte(doc)))
			assert.Nil(t, domain.DesignatedDisplay([]byte(doc)))
		})
	}
}

func TestResolveUserRef(t *testing.T) {
	user := func(attrs map[string]any) *domain.User {
		return &domain.User{ID: "user-1", Attributes: domain.AttributesFromMap(attrs)}
	}

	tests := []struct {
		name     string
		document string
		user     *domain.User
		want     domain.UserRef
	}{
		{
			name:     "identifier and display resolve independently",
			document: `{"x-identifier": "email", "x-display": ["givenName", "familyName"]}`,
			user:     user(map[string]any{"email": "ada@example.com", "givenName": "Ada", "familyName": "Lovelace"}),
			want: domain.UserRef{
				UserID: "user-1", Identifier: "ada@example.com",
				IdentifierProperty: "email", Display: "Ada Lovelace",
			},
		},
		{
			name:     "no designation degrades to the id",
			document: `{"type": "object"}`,
			user:     user(map[string]any{"email": "ada@example.com"}),
			want:     domain.UserRef{UserID: "user-1"},
		},
		{
			name:     "display without identifier",
			document: `{"x-display": ["givenName"]}`,
			user:     user(map[string]any{"givenName": "Ada"}),
			want:     domain.UserRef{UserID: "user-1", Display: "Ada"},
		},
		{
			name:     "identifier without value stays absent with its property",
			document: `{"x-identifier": "email", "x-display": ["givenName"]}`,
			user:     user(map[string]any{"givenName": "Ada"}),
			want:     domain.UserRef{UserID: "user-1", Display: "Ada"},
		},
		{
			name:     "absent display parts are skipped, not rendered empty",
			document: `{"x-display": ["givenName", "familyName"]}`,
			user:     user(map[string]any{"familyName": "Lovelace"}),
			want:     domain.UserRef{UserID: "user-1", Display: "Lovelace"},
		},
		{
			name:     "dot-path display entry addresses the flattened leaf",
			document: `{"x-display": ["profile.nickname"]}`,
			user:     user(map[string]any{"profile": map[string]any{"nickname": "ada"}}),
			want:     domain.UserRef{UserID: "user-1", Display: "ada"},
		},
		{
			name:     "non-string scalar identifier renders for the wire",
			document: `{"x-identifier": "employeeNumber"}`,
			user:     user(map[string]any{"employeeNumber": float64(4211)}),
			want:     domain.UserRef{UserID: "user-1", Identifier: "4211", IdentifierProperty: "employeeNumber"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, domain.ResolveUserRef(tt.user, []byte(tt.document)))
		})
	}
}
