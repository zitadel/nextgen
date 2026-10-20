package ui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestProjectOnCellPrefersSiteDefaults(t *testing.T) {
	eu1Store, err := cell.OpenStore(t.TempDir()+"/eu1.db", "http://eu-1", "eu-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer eu1Store.Close()
	us1Store, err := cell.OpenStore(t.TempDir()+"/us1.db", "http://us-1", "us-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer us1Store.Close()

	now := time.Now().UTC()
	if err := eu1Store.CreateProject(cell.Project{ID: "acme-fra", Name: "acme-fra", WorkspaceID: "acme", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := eu1Store.CreateProject(cell.Project{ID: "other", Name: "Other", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := us1Store.CreateProject(cell.Project{ID: "acme-iowa", Name: "acme-iowa", WorkspaceID: "acme", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}

	eu1Srv := cell.NewServer(eu1Store, nil, nil)
	us1Srv := cell.NewServer(us1Store, nil, nil)
	eu1HTTP := httptest.NewServer(eu1Srv.Handler())
	defer eu1HTTP.Close()
	us1HTTP := httptest.NewServer(us1Srv.Handler())
	defer us1HTTP.Close()

	app, err := NewApp([]CellRef{
		{Label: "eu-1", URL: eu1HTTP.URL},
		{Label: "us-1", URL: us1HTTP.URL},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	host, id, err := app.projectOnCell(ctx, "eu-1")
	if err != nil {
		t.Fatal(err)
	}
	if host != eu1HTTP.URL {
		t.Fatalf("host=%s", host)
	}
	if id != "acme-fra" {
		t.Fatalf("project=%s want acme-fra", id)
	}

	host, id, err = app.projectOnCell(ctx, "us-1")
	if err != nil {
		t.Fatal(err)
	}
	if host != us1HTTP.URL {
		t.Fatalf("host=%s", host)
	}
	if id != "acme-iowa" {
		t.Fatalf("project=%s want acme-iowa", id)
	}

	_ = http.StatusOK
}
