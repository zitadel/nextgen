// Package policy evaluates operation policies (ADR 066). A Zitadel-defined
// template per operation declares the settings a developer may configure,
// the context the rules receive and a list of named CEL rules; a
// developer-authored instance sets some of those settings for a project.
//
// Only what an instance sets is enforced: a template carries no defaults, a
// rule is active only when the setting it reads is set, and an operation
// without an instance has no active rule. What the server enforces
// regardless of any policy, such as the maximum password length, is a domain
// guard, not a policy.
package policy

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"regexp"
	"slices"
	"strings"
)

//go:embed templates/*.json
var templateFS embed.FS

// Template is the Zitadel-defined half of a policy for one operation.
type Template struct {
	Operation string `json:"operation"`
	// Config lists the settings an instance may set. A setting the instance
	// omits switches off the rule that reads it.
	Config map[string]Setting `json:"config"`
	// ConfigRules constrain the settings among each other. They read config
	// only and are checked when an instance is validated, never when the
	// operation runs.
	ConfigRules []Rule `json:"config_rules,omitempty"`
	// Context is the schema of the derived values the rules receive. It
	// doubles as the CEL type environment.
	Context ContextSchema `json:"context"`
	// Rules must all hold, as far as they are active, for the operation to
	// proceed.
	Rules []Rule `json:"rules"`
}

// Setting describes one value an instance may set: its type and, for an
// integer, the bounds the server can technically support. There is no
// default: an omitted setting is off.
type Setting struct {
	Type    SettingType `json:"type"`
	Minimum *int64      `json:"minimum,omitempty"`
	Maximum *int64      `json:"maximum,omitempty"`
}

// SettingType is the JSON type of a setting.
type SettingType string

const (
	SettingTypeInteger SettingType = "integer"
	SettingTypeBoolean SettingType = "boolean"
	SettingTypeString  SettingType = "string"
)

// Rule is one named boolean CEL expression.
//
// A rule in [Template.Rules] reads exactly one setting and carries that
// setting's name, so the name is at once the rule, the setting, the key of a
// violation and the key of a constraint. [New] enforces it.
type Rule struct {
	Name       string `json:"name"`
	Expression string `json:"expression"`
}

// ContextSchema is the shape of what rules receive. Keys are field names;
// values are either a type name (`int`, `bool`, `string`, `list<int>`,
// `list<bool>`, `list<string>`) or a nested ContextSchema. A rule
// referencing a field outside the schema fails to compile.
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
	path     string
	segments []string
	typ      string
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
				path := prefix + name
				out = append(out, contextField{path: path, segments: strings.Split(path, "."), typ: v})
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

// ParseTemplate decodes one template and checks its structure. An unknown
// key is an error, so a misspelled `config_rules` or a marker the format does
// not have (`default`, `public`) cannot be silently ignored. CEL compilation,
// and with it the checks that need the expressions, happens in [New].
func ParseTemplate(data []byte) (*Template, error) {
	if err := rejectDuplicateKeys(data); err != nil {
		return nil, fmt.Errorf("policy template: %w", err)
	}
	var t Template
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&t); err != nil {
		return nil, fmt.Errorf("policy template: %w", err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("policy template: unexpected data after the template")
	}
	if err := t.validate(); err != nil {
		return nil, fmt.Errorf("policy template %q: %w", t.Operation, err)
	}
	return &t, nil
}

func (t *Template) validate() error {
	if t.Operation == "" {
		return errors.New("operation is required")
	}
	for name, setting := range t.Config {
		if !publicName.MatchString(name) {
			return fmt.Errorf("setting %q: names must be snake_case", name)
		}
		switch setting.Type {
		case SettingTypeInteger, SettingTypeBoolean, SettingTypeString:
		default:
			return fmt.Errorf("setting %q: unsupported type %q", name, setting.Type)
		}
		if setting.Type != SettingTypeInteger && (setting.Minimum != nil || setting.Maximum != nil) {
			return fmt.Errorf("setting %q: bounds only apply to integers", name)
		}
		if setting.Minimum != nil && setting.Maximum != nil && *setting.Minimum > *setting.Maximum {
			return fmt.Errorf("setting %q: minimum %d is above maximum %d", name, *setting.Minimum, *setting.Maximum)
		}
	}
	if len(t.Rules) == 0 {
		return errors.New("at least one rule is required")
	}
	seen := make(map[string]struct{}, len(t.Rules)+len(t.ConfigRules))
	for _, rules := range [][]Rule{t.Rules, t.ConfigRules} {
		for i, rule := range rules {
			if rule.Name == "" {
				return fmt.Errorf("rule %d: name is required", i)
			}
			if !publicName.MatchString(rule.Name) {
				return fmt.Errorf("rule %q: names must be snake_case", rule.Name)
			}
			if _, dup := seen[rule.Name]; dup {
				return fmt.Errorf("rule %q: duplicate name", rule.Name)
			}
			seen[rule.Name] = struct{}{}
			if strings.TrimSpace(rule.Expression) == "" {
				return fmt.Errorf("rule %q: expression is required", rule.Name)
			}
		}
	}
	leaves, err := t.Context.leaves()
	if err != nil {
		return err
	}
	for _, leaf := range leaves {
		if !slices.Contains(contextTypes, leaf.typ) {
			return fmt.Errorf("context field %q: unsupported type %q, want one of %v", leaf.path, leaf.typ, contextTypes)
		}
	}
	return nil
}

// publicName is the shape of a setting or rule name. Both reach clients as
// keys of violations and constraints and as the suffix of login text keys,
// so they follow the wire's snake_case.
var publicName = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)

// contextTypes are the context field types the engine can both declare to
// CEL and coerce a request value into. CEL would accept more (nested lists),
// which would then fail every evaluation; they are refused here instead.
var contextTypes = []string{"int", "bool", "string", "list<int>", "list<bool>", "list<string>"}

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

// clone returns a deep copy, so a caller holding the result cannot change
// the template the engine validates and evaluates against.
func (t *Template) clone() *Template {
	out := *t
	out.Config = make(map[string]Setting, len(t.Config))
	for name, setting := range t.Config {
		if setting.Minimum != nil {
			setting.Minimum = new(*setting.Minimum)
		}
		if setting.Maximum != nil {
			setting.Maximum = new(*setting.Maximum)
		}
		out.Config[name] = setting
	}
	out.ConfigRules = slices.Clone(t.ConfigRules)
	out.Rules = slices.Clone(t.Rules)
	out.Context = t.Context.clone()
	return &out
}

func (c ContextSchema) clone() ContextSchema {
	out := maps.Clone(c)
	for name, value := range out {
		if nested, ok := value.(ContextSchema); ok {
			out[name] = nested.clone()
		}
	}
	return out
}
