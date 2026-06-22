//go:build postgres_integration || spanner_integration

package repository_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

type testObject struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
	Active bool   `json:"active"`
}

func TestJSONArray_Scan(t *testing.T) {
	type want struct {
		err error
		res []*testObject
	}
	tests := []struct {
		name string
		src  any
		want want
	}{
		{
			name: "nil",
			src:  nil,
			want: want{
				err: nil,
				res: nil,
			},
		},
		{
			name: "[]byte with data",
			src:  []byte(`[{"id":"1","number":1,"active":true}]`),
			want: want{
				err: nil,
				res: []*testObject{{ID: "1", Number: 1, Active: true}},
			},
		},
		{
			name: "[]byte without data",
			src:  []byte(`[]`),
			want: want{
				err: nil,
				res: nil,
			},
		},
		{
			name: "nil []byte",
			src:  []byte(nil),
			want: want{
				err: nil,
				res: nil,
			},
		},
		{
			name: "empty []byte",
			src:  []byte{},
			want: want{
				err: nil,
				res: nil,
			},
		},
		{
			name: "string with data",
			src:  `[{"id":"1","number":1,"active":true}]`,
			want: want{
				err: nil,
				res: []*testObject{{ID: "1", Number: 1, Active: true}},
			},
		},
		{
			name: "string without data",
			src:  string(`[]`),
			want: want{
				err: nil,
				res: nil,
			},
		},
		{
			name: "empty string",
			src:  "",
			want: want{
				err: nil,
				res: nil,
			},
		},
		{
			name: "wrong type",
			src:  []int{1, 2, 3},
			want: want{
				err: repository.ErrScanSource,
				res: nil,
			},
		},
		{
			name: "badly formatted JSON",
			src:  []byte(`this is not a JSON`),
			want: want{
				err: new(database.ScanError),
				res: nil,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var a repository.JSONArray[*testObject]
			gotErr := a.Scan(tt.src)
			require.ErrorIs(t, gotErr, tt.want.err)
			require.Len(t, a, len(tt.want.res))
		})
	}
}

func TestStringArray_String(t *testing.T) {
	t.Parallel()
	tt := []struct {
		name     string
		input    repository.StringArray
		expected string
	}{
		{"nil", nil, "{}"},
		{"empty", repository.StringArray{}, "{}"},
		{"single", repository.StringArray{"a"}, "{a}"},
		{"multiple", repository.StringArray{"a", "b"}, "{a,b}"},
		{"with single quote", repository.StringArray{"ab"}, "{ab}"},
		{"with comma", repository.StringArray{"a,b"}, "{a,b}"},
		{"with spaces", repository.StringArray{"a b"}, "{a b}"},
	}
	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.expected, tc.input.String())
		})
	}
}
