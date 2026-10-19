package policy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"math/big"
	"slices"
	"strconv"
	"strings"
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

// instanceKeys are the top-level keys an instance document may have.
var instanceKeys = []string{"$schema", "kind", "operation", "config"}

// ParseInstance decodes an instance document. Config values are checked
// against the template by [Engine.ValidateInstance].
func ParseInstance(data []byte) (*Instance, error) {
	if err := rejectDuplicateKeys(data); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidInstance, err)
	}
	// encoding/json matches field names without case; the envelope is
	// spelled exactly as documented or rejected. json.Unmarshal also rejects
	// data after the object.
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidInstance, err)
	}
	for key := range envelope {
		if !slices.Contains(instanceKeys, key) {
			return nil, fmt.Errorf("%w: unknown field %q, want one of %v", ErrInvalidInstance, key, instanceKeys)
		}
	}
	// A missing or null config is not "no rules": a merge that dropped the
	// block would switch the policy off without a word. Only an explicit {}
	// does that.
	if raw, ok := envelope["config"]; !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, fmt.Errorf("%w: config is required; use {} to switch every rule off", ErrInvalidInstance)
	}
	// The envelope keys are checked above, so the decode needs no
	// unknown-field check; an editor `$schema` pointer is simply not kept.
	dec := json.NewDecoder(bytes.NewReader(data))
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
// returns the settings that are valid, in their canonical Go type (int64,
// bool, string), and one problem per setting that is not.
func settingValues(t *Template, config map[string]any) (map[string]any, []error) {
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
	return out, problems
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

// maxNumberText and maxNumberExponent bound a JSON number before it is
// parsed exactly. They leave room for any int64 written with a fraction or
// an exponent ("9223372036854775807.000", "1.2e1"), and keep big.Rat from
// building a huge number such as 10^999999 (an 8-character "1e999999").
const (
	maxNumberText     = 32
	maxNumberExponent = 20
)

// numberExponentInRange reports whether a JSON number's exponent, if it has
// one, lies within ±maxNumberExponent.
func numberExponentInRange(text string) bool {
	i := strings.IndexAny(text, "eE")
	if i < 0 {
		return true
	}
	exp, err := strconv.Atoi(text[i+1:])
	return err == nil && exp >= -maxNumberExponent && exp <= maxNumberExponent
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
		// float64(math.MaxInt64) rounds up to 2^63, which int64 cannot hold,
		// so the upper bound is exclusive. -2^63 is exact and fits.
		if v != math.Trunc(v) || v >= math.MaxInt64 || v < math.MinInt64 {
			return 0, false
		}
		return int64(v), true
	case json.Number:
		// "12" parses directly; "12.0" and "1.2e1" are the same integer and
		// are accepted too. Other forms are parsed exactly as a rational, so
		// 0.99999999999999999 stays a fraction instead of rounding to 1 the
		// way a float64 would.
		if n, err := v.Int64(); err == nil {
			return n, true
		}
		// big.Rat accepts exponents up to a million and digit runs of any
		// length, and would build the whole number before the bounds check.
		// Every valid setting is a small integer, so a long text or a large
		// exponent is refused before it is parsed.
		if len(v) > maxNumberText || !numberExponentInRange(v.String()) {
			return 0, false
		}
		r, ok := new(big.Rat).SetString(v.String())
		if !ok || !r.IsInt() || !r.Num().IsInt64() {
			return 0, false
		}
		return r.Num().Int64(), true
	}
	return 0, false
}
