package policy

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"
)

// Audience is the ADR 065 applicability object: the set of requests an
// instance applies to. Empty means project default.
type Audience struct {
	TeamIDs []string `json:"team_ids,omitempty"`
}

// IsEmpty reports whether the audience is the project default.
func (a Audience) IsEmpty() bool {
	return len(a.TeamIDs) == 0
}

// Instance is the developer-authored half of a policy: config values for one
// operation and the audience they apply to.
type Instance struct {
	Kind      string         `json:"kind"`
	Operation string         `json:"operation"`
	Audience  Audience       `json:"audience,omitzero"`
	Config    map[string]any `json:"config"`
}

// KindPolicy is the `kind` every instance carries.
const KindPolicy = "policy"

// ParseInstance decodes an instance document. Config values are validated
// against the template by [Engine.ValidateInstance].
func ParseInstance(data []byte) (*Instance, error) {
	var inst Instance
	if err := json.Unmarshal(data, &inst); err != nil {
		return nil, fmt.Errorf("policy instance: %w", err)
	}
	if inst.Kind != KindPolicy {
		return nil, fmt.Errorf("policy instance: kind must be %q, got %q", KindPolicy, inst.Kind)
	}
	if inst.Operation == "" {
		return nil, fmt.Errorf("policy instance: operation is required")
	}
	return &inst, nil
}

// effectiveConfig validates the instance's config against the template and
// fills defaults, returning one canonical map keyed by setting name with
// integers as int64, booleans as bool and strings as string.
func effectiveConfig(t *Template, inst *Instance) (map[string]any, error) {
	for name := range inst.Config {
		setting, ok := t.Config[name]
		if !ok {
			return nil, fmt.Errorf("setting %q is not defined for operation %q", name, t.Operation)
		}
		if setting.Fixed {
			return nil, fmt.Errorf("setting %q is fixed by Zitadel and cannot be set", name)
		}
	}
	out := make(map[string]any, len(t.Config))
	for name, setting := range t.Config {
		raw, set := inst.Config[name]
		if !set {
			raw = setting.Default
		}
		value, err := coerceSetting(name, setting, raw)
		if err != nil {
			return nil, err
		}
		out[name] = value
	}
	return out, nil
}

// coerceSetting checks one value against its setting and returns it in the
// canonical Go type. JSON decoding yields float64 for every number, so
// integers are accepted from float64, int, int64 and json.Number.
func coerceSetting(name string, setting Setting, raw any) (any, error) {
	switch setting.Type {
	case SettingTypeInteger:
		n, ok := toInt64(raw)
		if !ok {
			return nil, fmt.Errorf("setting %q: expected an integer, got %v", name, raw)
		}
		if setting.Minimum != nil && n < *setting.Minimum {
			return nil, fmt.Errorf("setting %q: %d is below the minimum %d", name, n, *setting.Minimum)
		}
		if setting.Maximum != nil && n > *setting.Maximum {
			return nil, fmt.Errorf("setting %q: %d is above the maximum %d", name, n, *setting.Maximum)
		}
		return n, nil
	case SettingTypeBoolean:
		b, ok := raw.(bool)
		if !ok {
			return nil, fmt.Errorf("setting %q: expected a boolean, got %v", name, raw)
		}
		return b, nil
	case SettingTypeString:
		s, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("setting %q: expected a string, got %v", name, raw)
		}
		return s, nil
	}
	return nil, fmt.Errorf("setting %q: unsupported type %q", name, setting.Type)
}

func toInt64(raw any) (int64, bool) {
	switch v := raw.(type) {
	case int64:
		return v, true
	case int:
		return int64(v), true
	case float64:
		if v != math.Trunc(v) || v > math.MaxInt64 || v < math.MinInt64 {
			return 0, false
		}
		return int64(v), true
	case json.Number:
		n, err := v.Int64()
		return n, err == nil
	}
	return 0, false
}

// publicSettings returns the names of settings the constraints projection
// may return, sorted.
func (t *Template) publicSettings() []string {
	out := make([]string, 0, len(t.Config))
	for name, setting := range t.Config {
		if setting.Public {
			out = append(out, name)
		}
	}
	slices.Sort(out)
	return out
}
