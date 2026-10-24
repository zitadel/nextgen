package serviceping

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// catalog is the part of docs/product-analytics-events.yaml, the contract
// for what Zitadel's components send, that the ping is checked against.
type catalog struct {
	Header struct {
		Properties []string            `yaml:"properties"`
		Except     map[string][]string `yaml:"except"`
	} `yaml:"header"`
	Properties map[string]struct {
		Values []string `yaml:"values"`
	} `yaml:"properties"`
	Components map[string]struct {
		Context []string `yaml:"context"`
		Vercel  struct {
			Prefix string `yaml:"prefix"`
		} `yaml:"vercel"`
		Events map[string]struct {
			Properties   []string `yaml:"properties"`
			Destinations []string `yaml:"destinations"`
		} `yaml:"events"`
	} `yaml:"components"`
}

func loadCatalog(t *testing.T) catalog {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "docs", "product-analytics-events.yaml"))
	if err != nil {
		t.Fatalf("read the catalog: %v", err)
	}
	var c catalog
	if err := yaml.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse the catalog: %v", err)
	}
	return c
}

func TestPingSendsWhatTheCatalogLists(t *testing.T) {
	c := loadCatalog(t)
	server := c.Components["server"]
	name, ok := strings.CutPrefix(EventName, server.Vercel.Prefix)
	if !ok || server.Vercel.Prefix != EventPrefix {
		t.Fatalf("the catalog's Vercel prefix for the server is %q, the ping's %q", server.Vercel.Prefix, EventPrefix)
	}
	event, ok := server.Events[name]
	if !ok {
		t.Fatalf("the catalog lists no server event %q", name)
	}
	if !slices.Contains(event.Destinations, "vercel") {
		t.Errorf("the catalog does not send %q to vercel", name)
	}

	var want []string
	for _, property := range c.Header.Properties {
		property = strings.ReplaceAll(property, "<surface>", "server")
		if !slices.Contains(c.Header.Except["server"], property) {
			want = append(want, property)
		}
	}
	want = append(want, server.Context...)
	want = append(want, event.Properties...)
	slices.Sort(want)

	sent := Facts{}.Properties()
	if got := slices.Sorted(maps.Keys(sent)); !slices.Equal(got, want) {
		t.Errorf("the ping sends %v, the catalog lists %v", got, want)
	}
	if sent["surface"] != "server" {
		t.Errorf("surface = %v, want server", sent["surface"])
	}
}

func TestPingSendsOnlyServerKindsTheCatalogDefines(t *testing.T) {
	kinds := loadCatalog(t).Properties["server_kind"].Values
	for _, facts := range []Facts{{}, {PublicBase: "http://localhost:8080"}, {OnVercel: true}} {
		if kind := facts.Properties()["server_kind"]; !slices.Contains(kinds, kind.(string)) {
			t.Errorf("server_kind %q is not one of %v", kind, kinds)
		}
	}
}
