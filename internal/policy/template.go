// Package policy evaluates operation policies (ADR 066): a Zitadel-defined
// template per operation holds the config schema, the context schema and a
// list of named CEL rules; a developer-authored instance holds config values,
// an audience and an enforcement mode. Every rule must hold for the operation
// to proceed.
package policy

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"slices"
	"strings"
)

//go:embed templates/*.json
var templateFS embed.FS

// Template is the Zitadel-defined half of a policy for one operation.
type Template struct {
	Operation string             `json:"operation"`
	Config    map[string]Setting `json:"config"`
	Context   ContextSchema      `json:"context"`
	Rules     []Rule             `json:"rules"`
}

// Setting describes one configurable value: its JSON type, the bounds a
// developer may move within, the default used when an instance omits it, and
// whether the unauthenticated constraints projection may return it.
type Setting struct {
	Type    SettingType `json:"type"`
	Minimum *int64      `json:"minimum,omitempty"`
	Maximum *int64      `json:"maximum,omitempty"`
	Default any         `json:"default"`
	Public  bool        `json:"public,omitempty"`
}

// SettingType is the JSON type of a setting.
type SettingType string

const (
	SettingTypeInteger SettingType = "integer"
	SettingTypeBoolean SettingType = "boolean"
	SettingTypeString  SettingType = "string"
)

// Rule is one named boolean CEL expression over `config` and the context.
type Rule struct {
	Name       string `json:"name"`
	Expression string `json:"expression"`
}

// ContextSchema is the shape of what rules receive. Keys are field names;
// values are either a type name (`int`, `bool`, `string`, `list<int>`,
// `list<bool>`, `list<string>`) or a nested ContextSchema. It doubles as the
// CEL type environment: a rule referencing a field outside the schema fails
// to compile.
type ContextSchema map[string]any

// UnmarshalJSON keeps nested objects as ContextSchema so the tree can be
// walked with one type.
func (c *ContextSchema) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	out := make(ContextSchema, len(raw))
	for name, value := range raw {
		if len(value) > 0 && value[0] == '{' {
			var nested ContextSchema
			if err := json.Unmarshal(value, &nested); err != nil {
				return fmt.Errorf("context field %q: %w", name, err)
			}
			out[name] = nested
			continue
		}
		var typ string
		if err := json.Unmarshal(value, &typ); err != nil {
			return fmt.Errorf("context field %q: expected a type name or an object: %w", name, err)
		}
		out[name] = typ
	}
	*c = out
	return nil
}

// contextField is one leaf of a ContextSchema, addressed by its dotted path.
type contextField struct {
	path string
	typ  string
}

// leaves flattens the schema into dotted paths, sorted for determinism.
func (c ContextSchema) leaves() ([]contextField, error) {
	var out []contextField
	var walk func(prefix string, schema ContextSchema) error
	walk = func(prefix string, schema ContextSchema) error {
		for name, value := range schema {
			if strings.Contains(name, ".") {
				return fmt.Errorf("context field %q: names cannot contain dots", prefix+name)
			}
			switch v := value.(type) {
			case ContextSchema:
				if err := walk(prefix+name+".", v); err != nil {
					return err
				}
			case string:
				out = append(out, contextField{path: prefix + name, typ: v})
			default:
				return fmt.Errorf("context field %q: unsupported schema value %T", prefix+name, value)
			}
		}
		return nil
	}
	if err := walk("", c); err != nil {
		return nil, err
	}
	slices.SortFunc(out, func(a, b contextField) int { return strings.Compare(a.path, b.path) })
	return out, nil
}

// ParseTemplate decodes one template and checks its structure. CEL
// compilation happens in [New], which needs the limits.
func ParseTemplate(data []byte) (*Template, error) {
	var t Template
	if err := json.Unmarshal(data, &t); err != nil {
		return nil, fmt.Errorf("policy template: %w", err)
	}
	if err := t.validate(); err != nil {
		return nil, fmt.Errorf("policy template %q: %w", t.Operation, err)
	}
	return &t, nil
}

func (t *Template) validate() error {
	if t.Operation == "" {
		return fmt.Errorf("operation is required")
	}
	for name, setting := range t.Config {
		if strings.Contains(name, ".") {
			return fmt.Errorf("setting %q: names cannot contain dots", name)
		}
		switch setting.Type {
		case SettingTypeInteger, SettingTypeBoolean, SettingTypeString:
		default:
			return fmt.Errorf("setting %q: unsupported type %q", name, setting.Type)
		}
		if setting.Default == nil {
			return fmt.Errorf("setting %q: default is required", name)
		}
		if _, err := coerceSetting(name, setting, setting.Default); err != nil {
			return fmt.Errorf("setting %q: default: %w", name, err)
		}
		if setting.Type != SettingTypeInteger && (setting.Minimum != nil || setting.Maximum != nil) {
			return fmt.Errorf("setting %q: bounds only apply to integers", name)
		}
	}
	if len(t.Rules) == 0 {
		return fmt.Errorf("at least one rule is required")
	}
	seen := make(map[string]struct{}, len(t.Rules))
	for i, rule := range t.Rules {
		if rule.Name == "" {
			return fmt.Errorf("rule %d: name is required", i)
		}
		if _, dup := seen[rule.Name]; dup {
			return fmt.Errorf("rule %q: duplicate name", rule.Name)
		}
		seen[rule.Name] = struct{}{}
		if strings.TrimSpace(rule.Expression) == "" {
			return fmt.Errorf("rule %q: expression is required", rule.Name)
		}
	}
	if _, err := t.Context.leaves(); err != nil {
		return err
	}
	return nil
}

// embeddedTemplates parses every template shipped with the server.
func embeddedTemplates() ([]*Template, error) {
	entries, err := fs.ReadDir(templateFS, "templates")
	if err != nil {
		return nil, err
	}
	out := make([]*Template, 0, len(entries))
	for _, entry := range entries {
		data, err := templateFS.ReadFile("templates/" + entry.Name())
		if err != nil {
			return nil, err
		}
		t, err := ParseTemplate(data)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", entry.Name(), err)
		}
		out = append(out, t)
	}
	return out, nil
}
