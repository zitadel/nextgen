package database_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestListResultIterate(t *testing.T) {
	t.Parallel()

	first := &database.ListResult[string]{
		Items:      []string{"a", "b"},
		NextCursor: []byte("c1"),
	}
	second := &database.ListResult[string]{
		Items:      []string{"c"},
		NextCursor: nil,
	}

	var got []string
	for item, err := range first.Iterate(func(cursor []byte) (*database.ListResult[string], error) {
		assert.Equal(t, []byte("c1"), cursor)
		return second, nil
	}) {
		require.NoError(t, err)
		got = append(got, item)
	}
	assert.Equal(t, []string{"a", "b", "c"}, got)
}

func TestListResultIterate_FetchError(t *testing.T) {
	t.Parallel()

	first := &database.ListResult[string]{
		Items:      []string{"a"},
		NextCursor: []byte("c1"),
	}
	wantErr := errors.New("boom")

	var got []string
	var gotErr error
	for item, err := range first.Iterate(func(cursor []byte) (*database.ListResult[string], error) {
		return nil, wantErr
	}) {
		if err != nil {
			gotErr = err
			break
		}
		got = append(got, item)
	}
	assert.Equal(t, []string{"a"}, got)
	assert.ErrorIs(t, gotErr, wantErr)
}

func TestListResultIterate_NilNextStops(t *testing.T) {
	t.Parallel()

	first := &database.ListResult[string]{
		Items:      []string{"a"},
		NextCursor: []byte("c1"),
	}

	var got []string
	for item, err := range first.Iterate(func(cursor []byte) (*database.ListResult[string], error) {
		return nil, nil
	}) {
		require.NoError(t, err)
		got = append(got, item)
	}
	assert.Equal(t, []string{"a"}, got)
}
