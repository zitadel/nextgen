package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestJSONEqual(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		a, b   string
		ignore []string
		want   bool
	}{
		{
			name: "identical",
			a:    `{"name":"login","primary":true}`,
			b:    `{"name":"login","primary":true}`,
			want: true,
		},
		{
			name: "key order ignored",
			a:    `{"a":1,"b":2}`,
			b:    `{"b":2,"a":1}`,
			want: true,
		},
		{
			name: "whitespace ignored",
			a:    `{ "name" : "login" }`,
			b:    `{"name":"login"}`,
			want: true,
		},
		{
			name:   "ignored top-level key",
			a:      `{"$id":"sch_1","objectType":"human-user"}`,
			b:      `{"objectType":"human-user"}`,
			ignore: []string{"$id"},
			want:   true,
		},
		{
			name: "omitted false equals stored false",
			a:    `{"name":"login"}`,
			b:    `{"name":"login","primary":false}`,
			want: true,
		},
		{
			name: "omitted empty object equals stored empty object",
			a:    `{"name":"login"}`,
			b:    `{"name":"login","audience":{}}`,
			want: true,
		},
		{
			name: "nested zero values dropped",
			a:    `{"steps":[{"name":"a"}]}`,
			b:    `{"steps":[{"name":"a","primary":false,"extra":{}}]}`,
			want: true,
		},
		{
			name: "real difference",
			a:    `{"name":"login"}`,
			b:    `{"name":"register"}`,
			want: false,
		},
		{
			name: "true is not zero",
			a:    `{"primary":true}`,
			b:    `{}`,
			want: false,
		},
		{
			name: "empty array is zero",
			a:    `{"scopes":[]}`,
			b:    `{}`,
			want: true,
		},
		{
			name: "null is zero",
			a:    `{"logo":null}`,
			b:    `{}`,
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := domain.JSONEqual([]byte(tt.a), []byte(tt.b), tt.ignore...)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestJSONEqual_invalidJSON(t *testing.T) {
	t.Parallel()
	_, err := domain.JSONEqual([]byte(`{`), []byte(`{}`))
	require.Error(t, err)
}
