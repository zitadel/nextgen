package cell_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

// TestLookupWalkDelegatesParentChain proves UI-style clients hit the entry cell once;
// the cell walks us-1 → us-2 → eu-1 via POST /v1/lookup/walk (not three UI callers).
func TestLookupWalkDelegatesParentChain(t *testing.T) {
	eu1, eu1URL, c1 := startCell(t, "http://eu-1", "eu-1", false)
	defer c1()
	us2, us2URL, c2 := startCell(t, "http://us-2", "us-2", false)
	defer c2()
	us1, us1URL, c3 := startCell(t, "http://us-1", "us-1", false)
	defer c3()

	createProjectWS(t, eu1, "test", "test", false, true)
	createProjectWS(t, us2, "test-us2", "test", false, true)
	createProjectWS(t, us1, "test-us1-via-us2", "test", false, true)
	attachProject(t, us2, "test-us2", "test", eu1URL)
	attachProject(t, us1, "test-us1-via-us2", "test-us2", us2URL)

	created := postJSON(t, eu1, "/v1/projects/test/users", map[string]any{
		"email": "joe@example.com",
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create user status=%d body=%s", created.StatusCode, body)
	}

	peer := cell.NewPeerClient()
	res, hops, err := peer.LookupWalkRemote(t.Context(), us1URL, "test-us1-via-us2", "joe@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Hit {
		t.Fatalf("expected hit, hops=%+v", hops)
	}
	if res.HomeProjectID != "test" || res.FoundAtProjectID != "test" {
		t.Fatalf("home=%s found_at=%s want test", res.HomeProjectID, res.FoundAtProjectID)
	}

	// Authoritative chain: local miss @us-1, walk→us-2, local miss @us-2, walk→eu-1, local hit @eu-1.
	if len(hops) < 5 {
		t.Fatalf("trace hops=%d want >=5: %+v", len(hops), hops)
	}

	norm := cell.NormalizeURL
	want := []struct {
		from, cell, method, result string
	}{
		{norm(us1URL), norm(us1URL), "local lookup", "miss"},
		{norm(us1URL), norm(us2URL), "POST /v1/lookup/walk", "hit"},
		{norm(us2URL), norm(us2URL), "local lookup", "miss"},
		{norm(us2URL), norm(eu1URL), "POST /v1/lookup/walk", "hit"},
		{norm(eu1URL), norm(eu1URL), "local lookup", "hit"},
	}
	for i, w := range want {
		h := hops[i]
		if cell.NormalizeURL(h.From) != w.from {
			t.Errorf("hop %d From=%q want %q", i, h.From, w.from)
		}
		if cell.NormalizeURL(h.Cell) != w.cell {
			t.Errorf("hop %d Cell=%q want %q", i, h.Cell, w.cell)
		}
		if !strings.EqualFold(h.Method, w.method) && h.Method != w.method {
			t.Errorf("hop %d Method=%q want %q", i, h.Method, w.method)
		}
		if h.Result != w.result {
			t.Errorf("hop %d Result=%q want %q", i, h.Result, w.result)
		}
	}

	// No hop should look like three independent UI callers (empty From on every site visit).
	uiStyle := 0
	for _, h := range hops {
		if h.From == "" && isSemantic(h.Result) {
			uiStyle++
		}
	}
	if uiStyle > 0 {
		t.Fatalf("expected From set on semantic hops (got %d empty-From semantic hops)", uiStyle)
	}
}

func isSemantic(r string) bool {
	switch strings.ToLower(strings.TrimSpace(r)) {
	case "miss", "hit", "tombstone":
		return true
	default:
		return false
	}
}
