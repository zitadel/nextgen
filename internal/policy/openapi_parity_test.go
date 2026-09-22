package policy_test

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/zitadel/nextgen/internal/policy"
)

// The wire schema of an instance is a union discriminated on `operation`,
// one OpenAPI branch per template. The branch is hand-written (it carries
// descriptions the template does not), so this test keeps its `config`
// properties, bounds and defaults equal to the template's: a drift here
// would let an editor accept what the server rejects, or the reverse.
func TestOpenAPIBranchesMatchTemplates(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	root := filepath.Join(filepath.Dir(file), "..", "..")
	unionPath := filepath.Join(root, "api", "openapi", "components", "flows", "policy.yaml")

	var union struct {
		Discriminator struct {
			PropertyName string            `yaml:"propertyName"`
			Mapping      map[string]string `yaml:"mapping"`
		} `yaml:"discriminator"`
	}
	mustLoadYAML(t, unionPath, &union)
	if union.Discriminator.PropertyName != "operation" {
		t.Fatalf("discriminator = %q, want operation", union.Discriminator.PropertyName)
	}

	e, err := policy.New()
	if err != nil {
		t.Fatal(err)
	}
	for _, op := range e.Operations() {
		branchFile, ok := union.Discriminator.Mapping[op]
		if !ok {
			t.Fatalf("operation %q has a template but no OpenAPI branch in %s", op, unionPath)
		}
		tmpl, _ := e.Template(op)
		var branch struct {
			Properties struct {
				Operation struct {
					Enum []string `yaml:"enum"`
				} `yaml:"operation"`
				Config struct {
					AdditionalProperties bool `yaml:"additionalProperties"`
					Properties           map[string]struct {
						Type    string `yaml:"type"`
						Minimum *int64 `yaml:"minimum"`
						Maximum *int64 `yaml:"maximum"`
						Default any    `yaml:"default"`
					} `yaml:"properties"`
				} `yaml:"config"`
			} `yaml:"properties"`
		}
		mustLoadYAML(t, filepath.Join(filepath.Dir(unionPath), branchFile), &branch)
		if got := branch.Properties.Operation.Enum; len(got) != 1 || got[0] != op {
			t.Errorf("%s: operation enum = %v, want [%s]", branchFile, got, op)
		}
		if branch.Properties.Config.AdditionalProperties {
			t.Errorf("%s: config must close its property set", branchFile)
		}
		for name, setting := range tmpl.Config {
			prop, ok := branch.Properties.Config.Properties[name]
			if setting.Fixed {
				if ok {
					t.Errorf("%s: fixed setting %q must not be settable on the wire", branchFile, name)
				}
				continue
			}
			if !ok {
				t.Errorf("%s: setting %q missing from the wire schema", branchFile, name)
				continue
			}
			if prop.Type != string(setting.Type) {
				t.Errorf("%s: %q type = %s, template %s", branchFile, name, prop.Type, setting.Type)
			}
			if !equalBound(prop.Minimum, setting.Minimum) || !equalBound(prop.Maximum, setting.Maximum) {
				t.Errorf("%s: %q bounds differ from the template", branchFile, name)
			}
			if wantDefault, gotDefault := yamlScalar(setting.Default), yamlScalar(prop.Default); wantDefault != gotDefault {
				t.Errorf("%s: %q default = %v, template %v", branchFile, name, gotDefault, wantDefault)
			}
		}
		for name := range branch.Properties.Config.Properties {
			if _, ok := tmpl.Config[name]; !ok {
				t.Errorf("%s: %q is not a setting of %s", branchFile, name, op)
			}
		}
	}
}

func mustLoadYAML(t *testing.T, path string, out any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := yaml.Unmarshal(data, out); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
}

func equalBound(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// yamlScalar renders numbers from JSON (float64) and YAML (int) the same.
func yamlScalar(v any) string {
	switch n := v.(type) {
	case float64:
		return formatFloat(n)
	case int:
		return formatFloat(float64(n))
	case int64:
		return formatFloat(float64(n))
	}
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(fmtAny(v), "\n", ""), " ", ""))
}

func formatFloat(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func fmtAny(v any) string { return fmt.Sprint(v) }
