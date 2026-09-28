package domain

import "testing"

func TestResourcePrefixMatches(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		id   string
		want bool
	}{
		{name: "prefix and body", id: "proj_01H0000000000000000000000", want: true},
		{name: "readable body", id: "proj_platform", want: true},
		{name: "empty body", id: "proj_", want: false},
		{name: "prefix without separator", id: "proj", want: false},
		{name: "wrong prefix", id: "user_01H0000000000000000000000", want: false},
		{name: "empty string", id: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := PrefixProject.Matches(tt.id); got != tt.want {
				t.Errorf("PrefixProject.Matches(%q) = %v, want %v", tt.id, got, tt.want)
			}
		})
	}
}

func TestPlatformProjectID(t *testing.T) {
	t.Parallel()
	if PlatformProjectID != "proj_platform" {
		t.Errorf("PlatformProjectID = %q, want %q", PlatformProjectID, "proj_platform")
	}
	if !PrefixProject.Matches(PlatformProjectID) {
		t.Errorf("PlatformProjectID %q must be well-formed under PrefixProject", PlatformProjectID)
	}
}
