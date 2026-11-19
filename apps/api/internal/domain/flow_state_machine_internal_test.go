package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The collected document keeps the schema's shape, so a dotted unique field
// is read from its nested object: missing it lets a passkey sign-up with a
// taken value reach the browser.
func TestUniqueFieldValues(t *testing.T) {
	resolved := FlowResolvedFields{Fields: []FlowField{
		{Name: "email", Unique: AttributeUniquenessProject},
		{Name: "account.handle", Unique: AttributeUniquenessProject},
		{Name: "nickname"},
	}}
	tests := []struct {
		name   string
		values map[string]any
		want   [][2]string
	}{
		{
			name: "top-level and nested",
			values: map[string]any{
				"email":    "alice@example.com",
				"account":  map[string]any{"handle": "alice"},
				"nickname": "al",
			},
			want: [][2]string{{"email", "alice@example.com"}, {"account.handle", "alice"}},
		},
		{
			name:   "empty nested value",
			values: map[string]any{"account": map[string]any{"handle": ""}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, uniqueFieldValues(tt.values, resolved))
		})
	}
}
