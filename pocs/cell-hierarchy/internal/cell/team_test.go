package cell_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestCreateTeamUnderProject(t *testing.T) {
	srv, _, cleanup := startCell(t, "http://us", "us", false)
	defer cleanup()
	createProject(t, srv, "us", false, false)

	created := postJSON(t, srv, "/v1/projects/us/teams", map[string]any{
		"name": "Engineering",
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create team status=%d body=%s", created.StatusCode, body)
	}
	var parent cell.TeamView
	decode(t, created, &parent)
	if parent.Name != "Engineering" || parent.ProjectID != "us" || parent.ID == "" {
		t.Fatalf("team=%+v", parent)
	}

	child := postJSON(t, srv, "/v1/projects/us/teams", map[string]any{
		"name": "Platform", "parent_team_id": parent.ID,
	})
	defer child.Body.Close()
	if child.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(child.Body)
		t.Fatalf("create sub-team status=%d body=%s", child.StatusCode, body)
	}
	var sub cell.TeamView
	decode(t, child, &sub)
	if sub.ParentTeamID != parent.ID {
		t.Fatalf("parent_team_id=%s want %s", sub.ParentTeamID, parent.ID)
	}

	listed := getJSON(t, srv, "/v1/projects/us/teams")
	defer listed.Body.Close()
	var list struct {
		Teams []cell.TeamView `json:"teams"`
	}
	decode(t, listed, &list)
	if len(list.Teams) != 2 {
		t.Fatalf("teams=%d want 2", len(list.Teams))
	}

	detail := getJSON(t, srv, "/v1/projects/us")
	defer detail.Body.Close()
	var body struct {
		Teams []cell.TeamView `json:"teams"`
	}
	decode(t, detail, &body)
	if len(body.Teams) != 2 {
		t.Fatalf("project detail teams=%d want 2", len(body.Teams))
	}

	badParent := postJSON(t, srv, "/v1/projects/us/teams", map[string]any{
		"name": "Orphan", "parent_team_id": "missing",
	})
	defer badParent.Body.Close()
	assertError(t, badParent, "parent_team_not_found")
}
