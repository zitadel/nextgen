package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestNormalizeLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{name: "zero uses default", limit: 0, want: defaultListLimit},
		{name: "negative uses default", limit: -5, want: defaultListLimit},
		{name: "one is kept", limit: 1, want: 1},
		{name: "mid-range is kept", limit: 50, want: 50},
		{name: "max is kept", limit: maxListLimit, want: maxListLimit},
		{name: "above max is capped", limit: 500, want: maxListLimit},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, normalizeLimit(tc.limit))
		})
	}
}

func TestMapListError(t *testing.T) {
	t.Parallel()

	t.Run("invalid cursor maps to request invalid", func(t *testing.T) {
		t.Parallel()
		err := mapListError(database.ErrInvalidCursor(), "failed to list projects")
		require.ErrorIs(t, err, domain.ErrRequestInvalid())
		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.Equal(t, "invalid page token", de.Details)
	})

	t.Run("cursor order mismatch maps to request invalid", func(t *testing.T) {
		t.Parallel()
		err := mapListError(database.ErrCursorOrderMismatch(), "failed to list projects")
		require.ErrorIs(t, err, domain.ErrRequestInvalid())
		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.Equal(t, "page token does not match the requested sorting", de.Details)
	})

	t.Run("other errors are wrapped as internal with the given message", func(t *testing.T) {
		t.Parallel()
		err := mapListError(assert.AnError, "failed to list projects")
		require.ErrorIs(t, err, domain.ErrInternal(assert.AnError))
		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.Equal(t, "failed to list projects", de.Message)
		assert.ErrorIs(t, err, assert.AnError)
	})
}

func TestParseSortDirection(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		direction string
		want      database.OrderDirection
		wantErr   error
	}{
		{name: "empty is invalid", direction: "", want: database.OrderAsc, wantErr: domain.ErrRequestInvalid()},
		{name: "asc", direction: sortAsc, want: database.OrderAsc},
		{name: "desc", direction: sortDesc, want: database.OrderDesc},
		{name: "unknown is invalid", direction: "sideways", want: database.OrderAsc, wantErr: domain.ErrRequestInvalid()},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseSortDirection(tc.direction)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestCompareFilter(t *testing.T) {
	t.Parallel()

	col := database.Col(domain.ProjectFieldCreatedAt)
	ts := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name    string
		op      string
		value   any
		want    database.Filter[domain.ProjectField]
		wantErr error
	}{
		{name: "equals string", op: filterOpEquals, value: "v", want: database.Equal(col, "v")},
		{name: "equals time", op: filterOpEquals, value: ts, want: database.Equal(col, ts)},
		{name: "equals int", op: filterOpEquals, value: 42, want: database.Equal(col, 42)},
		{name: "less_than time", op: filterOpLessThan, value: ts, want: database.LessThan(col, ts)},
		{name: "greater_than time", op: filterOpGreaterThan, value: ts, want: database.GreaterThan(col, ts)},
		{name: "greater_than_or_equal time", op: filterOpGreaterThanOrEqual, value: ts, want: database.GreaterThanOrEqual(col, ts)},
		{name: "not_equals not implemented", op: filterOpNotEquals, value: "v", wantErr: domain.ErrNotImplemented()},
		{name: "less_than_or_equal not implemented", op: filterOpLessThanOrEqual, value: "v", wantErr: domain.ErrNotImplemented()},
		{name: "contains is invalid for a comparable field", op: filterOpContains, value: "v", wantErr: domain.ErrRequestInvalid()},
		{name: "not_contains is invalid for a comparable field", op: filterOpNotContains, value: "v", wantErr: domain.ErrRequestInvalid()},
		{name: "unknown op is invalid", op: "bogus", value: "v", wantErr: domain.ErrRequestInvalid()},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := compareFilter(tc.op, col, tc.value)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestStringFilter(t *testing.T) {
	t.Parallel()

	col := database.Col(domain.ProjectFieldName)
	value := "acme"

	tests := []struct {
		name    string
		op      string
		want    database.Filter[domain.ProjectField]
		wantErr error
	}{
		{name: "equals", op: filterOpEquals, want: database.StringEqual(col, value)},
		{name: "contains", op: filterOpContains, want: database.StringContains(col, value)},
		{name: "not_equals not implemented", op: filterOpNotEquals, wantErr: domain.ErrNotImplemented()},
		{name: "not_contains not implemented", op: filterOpNotContains, wantErr: domain.ErrNotImplemented()},
		{name: "less_than is invalid for a string field", op: filterOpLessThan, wantErr: domain.ErrRequestInvalid()},
		{name: "greater_than is invalid for a string field", op: filterOpGreaterThan, wantErr: domain.ErrRequestInvalid()},
		{name: "less_than_or_equal is invalid for a string field", op: filterOpLessThanOrEqual, wantErr: domain.ErrRequestInvalid()},
		{name: "greater_than_or_equal is invalid for a string field", op: filterOpGreaterThanOrEqual, wantErr: domain.ErrRequestInvalid()},
		{name: "unknown op is invalid", op: "bogus", wantErr: domain.ErrRequestInvalid()},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := stringFilter(tc.op, col, value)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}
