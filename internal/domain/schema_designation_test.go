package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestDesignatedIdentifier(t *testing.T) {
	tests := []struct {
		name     string
		document string
		want     string
	}{
		{
			name:     "designating document",
			document: `{"type":"object","x-identifier":"email"}`,
			want:     "email",
		},
		{
			name:     "no designation",
			document: `{"type":"object"}`,
			want:     "",
		},
		{
			name:     "non-string designation reads as undesignated",
			document: `{"x-identifier":["email"]}`,
			want:     "",
		},
		{
			name:     "non-object document reads as undesignated",
			document: `true`,
			want:     "",
		},
		{
			name:     "malformed document reads as undesignated",
			document: `{`,
			want:     "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, domain.DesignatedIdentifier([]byte(tt.document)))
		})
	}
}
