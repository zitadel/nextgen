package database_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestEqualsFilterRestricts(t *testing.T) {
	filter := database.Equal(database.Col(domain.ProjectFieldID), "proj_1")
	if !filter.Restricts(database.Col(domain.ProjectFieldID)) {
		t.Fatal("expected filter to restrict id column")
	}
	if filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)) {
		t.Fatal("expected filter not to restrict created_at column")
	}
}

func TestAndFilterRestricts(t *testing.T) {
	filter := database.And(
		database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
	)
	if !filter.Restricts(database.Col(domain.ProjectFieldID)) {
		t.Fatal("expected AND filter to restrict id column")
	}
	if !filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)) {
		t.Fatal("expected AND filter to restrict created_at column")
	}
	if filter.Restricts(database.Col(domain.ProjectFieldUpdatedAt)) {
		t.Fatal("expected AND filter not to restrict updated_at column")
	}
}

func TestOrFilterRestricts(t *testing.T) {
	filter := database.Or(
		database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
	)
	if !filter.Restricts(database.Col(domain.ProjectFieldID)) || !filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)) {
		t.Fatal("expected OR filter to restrict both child columns")
	}
	if filter.Restricts(database.Col(domain.ProjectFieldUpdatedAt)) {
		t.Fatal("expected OR filter not to restrict updated_at column")
	}
}

func TestGreaterAndLessThanFilterRestricts(t *testing.T) {
	gt := database.GreaterThan(database.Col(domain.ProjectFieldCreatedAt), "t1")
	lt := database.LessThan(database.Col(domain.ProjectFieldID), "proj_1")
	if !gt.Restricts(database.Col(domain.ProjectFieldCreatedAt)) {
		t.Fatal("expected greater-than filter to restrict created_at")
	}
	if !lt.Restricts(database.Col(domain.ProjectFieldID)) {
		t.Fatal("expected less-than filter to restrict id")
	}
}
