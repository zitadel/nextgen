package spanner

import "testing"

func TestNewEphemeralID(t *testing.T) {
	seen := make(map[int64]struct{}, 1000)
	for range 1000 {
		id, err := NewEphemeralID()
		if err != nil {
			t.Fatalf("NewEphemeralID() error: %v", err)
		}
		if id <= 0 {
			t.Fatalf("NewEphemeralID() = %d, want positive", id)
		}
		if _, dup := seen[id]; dup {
			t.Fatalf("NewEphemeralID() produced duplicate %d within 1000 draws", id)
		}
		seen[id] = struct{}{}
	}
}
