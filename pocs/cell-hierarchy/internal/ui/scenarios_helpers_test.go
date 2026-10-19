package ui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestProjectOnCellPrefersMatchingID(t *testing.T) {
	usStore, err := cell.OpenStore(t.TempDir()+"/us.db", "http://us", "us", false)
	if err != nil {
		t.Fatal(err)
	}
	defer usStore.Close()
	eu2Store, err := cell.OpenStore(t.TempDir()+"/eu2.db", "http://eu-2", "eu-2", false)
	if err != nil {
		t.Fatal(err)
	}
	defer eu2Store.Close()

	now := time.Now().UTC()
	if err := usStore.CreateProject(cell.Project{ID: "us", Name: "US", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := usStore.CreateProject(cell.Project{ID: "other", Name: "Other", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := eu2Store.CreateProject(cell.Project{ID: "team-eu-2", Name: "Team EU-2", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}

	usSrv := cell.NewServer(usStore, nil, nil)
	eu2Srv := cell.NewServer(eu2Store, nil, nil)
	usHTTP := httptest.NewServer(usSrv.Handler())
	defer usHTTP.Close()
	eu2HTTP := httptest.NewServer(eu2Srv.Handler())
	defer eu2HTTP.Close()

	// Rewrite meta URLs to the httptest base so ListProjects HostCellURL matches.
	app, err := NewApp([]CellRef{
		{Label: "us", URL: usHTTP.URL},
		{Label: "eu-2", URL: eu2HTTP.URL},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	host, id, err := app.projectOnCell(ctx, "us")
	if err != nil {
		t.Fatal(err)
	}
	if host != usHTTP.URL {
		t.Fatalf("host=%s", host)
	}
	if id != "us" {
		t.Fatalf("project=%s want us", id)
	}

	host, id, err = app.projectOnCell(ctx, "eu-2")
	if err != nil {
		t.Fatal(err)
	}
	if host != eu2HTTP.URL {
		t.Fatalf("host=%s", host)
	}
	if id != "team-eu-2" {
		t.Fatalf("project=%s want team-eu-2 (first / only local)", id)
	}

	_ = http.StatusOK
}
