package policy

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"slices"
)

// Instance is the developer-authored half of a policy: the settings a
// project sets for one operation. A setting it omits is off.
type Instance struct {
	Kind      string         `json:"kind"`
	Operation string         `json:"operation"`
	Config    map[string]any `json:"config"`
}

// KindPolicy is the `kind` every instance carries.
const KindPolicy = "policy"

// ParseInstance decodes an instance document. Config values are checked
// against the template by [Engine.ValidateInstance].
func ParseInstance(data []byte) (*Instance, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	dec.UseNumber()
	var inst Instance
	if err := dec.Decode(&inst); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidInstance, err)
	}
	if inst.Kind != KindPolicy {
		return nil, fmt.Errorf("%w: kind must be %q, got %q", ErrInvalidInstance, KindPolicy, inst.Kind)
	}
	if inst.Operation == "" {
		return nil, fmt.Errorf("%w: operation is required", ErrInvalidInstance)
	}
	return &inst, nil
}

// settingValues checks the instance's config against the template and
// returns the set settings in their canonical Go type (int64, bool,
// string). Every problem is reported, not just the first.
func settingValues(t *Template, config map[string]any) (map[string]any, error) {
	out := make(map[string]any, len(config))
	var problems []error
	for _, name := range slices.Sorted(maps.Keys(config)) {
		setting, ok := t.Config[name]
		if !ok {
			problems = append(problems, fmt.Errorf("setting %q is not defined for operation %q", name, t.Operation))
			continue
		}
		value, err := coerceSetting(name, setting, config[name])
		if err != nil {
			problems = append(problems, err)
			continue
		}
		out[name] = value
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("%w: %w", ErrInvalidInstance, errors.Join(problems...))
	}
	return out, nil
}

// coerceSetting checks one value against its setting and returns it in the
// canonical Go type.
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

// toInt64 accepts the integer shapes JSON decoding and Go callers produce.
func toInt64(raw any) (int64, bool) {
	switch v := raw.(type) {
	case int64:
		return v, true
	case int:
		return int64(v), true
	case int32:
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
