package server

import (
	"testing"
)

func TestLoadConfigReadsPostgresDatabaseEnv(t *testing.T) {
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", "postgresql://postgres@localhost:5432/nextgen?sslmode=disable")

	cfg, err := loadConfig("")
	if err != nil {
		t.Fatalf("loadConfig() error = %v", err)
	}

	if got, ok := cfg.Database.Raw["postgres"]; !ok {
		t.Fatalf("cfg.Database.Raw missing postgres key: %#v", cfg.Database.Raw)
	} else if got != "postgresql://postgres@localhost:5432/nextgen?sslmode=disable" {
		t.Fatalf("cfg.Database.Raw[postgres] = %#v, want DSN", got)
	}
}
