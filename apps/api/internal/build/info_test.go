package build

import (
	"testing"
	"time"
)

func TestUnstampedBuildDefaults(t *testing.T) {
	if got := Version(); got != "dev" {
		t.Fatalf("Version() = %q, want dev", got)
	}
	if got := Commit(); got != "none" {
		t.Fatalf("Commit() = %q, want none", got)
	}
	if got := Date(); !got.Equal(time.Time{}) {
		t.Fatalf("Date() = %s, want zero time", got)
	}
}
