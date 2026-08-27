package api

import (
	"testing"

	api "github.com/zitadel/nextgen/api/generated"
)

// The membership gate on POST /users/query keys off this, so a field that reads
// like a team but is not a membership must not trip it: lifecycle_owner_team_id
// is a column on the user and carries no membership read (ADR 024).
func TestFiltersOnTeamID(t *testing.T) {
	filter := func(fields ...api.UserFilterField) []api.QueryUsersRequestFilterItem {
		items := make([]api.QueryUsersRequestFilterItem, 0, len(fields))
		for _, field := range fields {
			items = append(items, api.QueryUsersRequestFilterItem{Field: field})
		}
		return items
	}

	tests := []struct {
		name    string
		filters []api.QueryUsersRequestFilterItem
		want    bool
	}{
		{"no filters", nil, false},
		{"unrelated field", filter(api.UserFilterFieldStatus), false},
		{"lifecycle owner is not membership", filter(api.UserFilterFieldLifecycleOwnerTeamID), false},
		{"team id", filter(api.UserFilterFieldTeamID), true},
		{"team id among others", filter(api.UserFilterFieldStatus, api.UserFilterFieldTeamID), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := filtersOnTeamID(tt.filters); got != tt.want {
				t.Fatalf("filtersOnTeamID() = %v, want %v", got, tt.want)
			}
		})
	}
}
