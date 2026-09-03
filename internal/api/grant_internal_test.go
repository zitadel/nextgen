package api

import (
	"testing"

	api "github.com/zitadel/nextgen/api/generated"
)

func TestMapQueryGrantsToService_Expand(t *testing.T) {
	tests := []struct {
		name     string
		expand   []api.GrantExpand
		wantIncl bool
	}{
		{"none", nil, false},
		{"principal", []api.GrantExpand{api.GrantExpandPrincipal}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := mapQueryGrantsToService("proj_a", &api.QueryGrantsRequest{Expand: tt.expand})
			if input.IncludePrincipal != tt.wantIncl {
				t.Fatalf("IncludePrincipal = %v, want %v", input.IncludePrincipal, tt.wantIncl)
			}
		})
	}
}
