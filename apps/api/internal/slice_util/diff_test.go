package slice_util_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/slice_util"
)

func TestDiffFunc(t *testing.T) {
	t.Parallel()

	type item struct {
		key   string
		value int
	}
	sameKey := func(f, t item) bool { return f.key == t.key }

	tests := []struct {
		name        string
		from        []item
		to          []item
		wantAdded   []item
		wantRemoved []item
	}{
		{
			name: "both empty",
		},
		{
			name:      "every element of to is added to an empty from",
			to:        []item{{key: "a"}, {key: "b"}},
			wantAdded: []item{{key: "a"}, {key: "b"}},
		},
		{
			name:        "every element of from is removed by an empty to",
			from:        []item{{key: "a"}, {key: "b"}},
			wantRemoved: []item{{key: "a"}, {key: "b"}},
		},
		{
			name:        "added holds elements of to, removed elements of from",
			from:        []item{{key: "a", value: 1}, {key: "b", value: 1}},
			to:          []item{{key: "b", value: 2}, {key: "c", value: 2}},
			wantAdded:   []item{{key: "c", value: 2}},
			wantRemoved: []item{{key: "a", value: 1}},
		},
		{
			name: "equal elements are neither added nor removed",
			from: []item{{key: "a", value: 1}},
			to:   []item{{key: "a", value: 2}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			added, removed := slice_util.DiffFunc(tt.from, tt.to, sameKey)
			assert.ElementsMatch(t, tt.wantAdded, added)
			assert.ElementsMatch(t, tt.wantRemoved, removed)
		})
	}
}

// TestDiffFuncComparatorOrder pins the order the comparator gets its
// arguments in: an element of from first, an element of to second.
func TestDiffFuncComparatorOrder(t *testing.T) {
	t.Parallel()

	from := []string{"from-1", "from-2"}
	to := []string{"to-1", "to-2"}
	slice_util.DiffFunc(from, to, func(f, tt string) bool {
		assert.Contains(t, from, f)
		assert.Contains(t, to, tt)
		return false
	})
}
