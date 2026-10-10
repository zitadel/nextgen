package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/zitadel/nextgen/apps/cloud/internal/deployment"
)

type config struct {
	Port string
	// DatabaseURL is the home's database, served from; MigratorURL the URL
	// the migrations use (DatabaseURL when none is set).
	DatabaseURL string
	MigratorURL string
	// Host is where the home and the regions are reached; HomeURL the home
	// itself, https://<Host> unless set explicitly.
	Host    string
	HomeURL string
	// Headers go on every call to the home and the regions: the deployment
	// protection bypass while the deployment is protected.
	Headers map[string]string
	Regions []region
}

func configFromEnv() (config, error) {
	cfg := config{Port: os.Getenv("PORT")}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	cfg.DatabaseURL = firstEnv("CLOUD_DATABASE_URL_HOME", "CLOUD_DATABASE_URL")
	if cfg.DatabaseURL == "" {
		return config{}, errors.New("CLOUD_DATABASE_URL_HOME must be set (the home's database)")
	}
	cfg.MigratorURL = firstEnv("CLOUD_MIGRATOR_DATABASE_URL_HOME", "CLOUD_MIGRATOR_DATABASE_URL")
	if cfg.MigratorURL == "" {
		cfg.MigratorURL = cfg.DatabaseURL
	}
	cfg.Host = deployment.Host()
	if cfg.Host == "" {
		return config{}, fmt.Errorf("no host is known: set %s, or expose VERCEL_URL", deployment.HostVariable)
	}
	cfg.HomeURL = os.Getenv("NEXTGEN_PLATFORM_HOME_URL")
	if cfg.HomeURL == "" {
		cfg.HomeURL = "https://" + cfg.Host
	}
	if secret := os.Getenv("CLOUD_HOME_BYPASS_SECRET"); secret != "" {
		cfg.Headers = map[string]string{"x-vercel-protection-bypass": secret}
	}
	regions, err := parseRegions(os.Getenv("CLOUD_REGIONS"))
	if err != nil {
		return config{}, err
	}
	if len(regions) == 0 {
		return config{}, errors.New("CLOUD_REGIONS must list at least one region")
	}
	cfg.Regions = regions
	return cfg, nil
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return ""
}
