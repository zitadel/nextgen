package policy

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
)

// Engine holds every compiled template and evaluates instances against
// request contexts. It is stateless: it never fetches its own inputs.
type Engine struct {
	templates map[string]*compiledTemplate
}

type compiledTemplate struct {
	*Template
	rules       []*compiledRule
	configRules []*compiledRule
	leaves      []contextField
}

// Option configures an [Engine].
type Option func(*options)

type options struct {
	limits    Limits
	templates []*Template
}

// WithLimits overrides [DefaultLimits].
func WithLimits(l Limits) Option {
	return func(o *options) { o.limits = l }
}

// WithTemplates replaces the embedded catalog. Tests use it; the server
// runs on the embedded templates.
func WithTemplates(ts ...*Template) Option {
	return func(o *options) { o.templates = ts }
}

// New compiles the catalog. Every rule is type-checked against its
// template's settings and context and checked against the limits, and every
// rule must read exactly one setting and carry its name, so a template the
// server cannot evaluate, or whose violations clients could not key, fails
// here rather than at the first request.
func New(opts ...Option) (*Engine, error) {
	o := options{limits: DefaultLimits}
	for _, opt := range opts {
		opt(&o)
	}
	if o.templates == nil {
		ts, err := embeddedTemplates()
		if err != nil {
			return nil, err
		}
		o.templates = ts
	}
	e := &Engine{templates: make(map[string]*compiledTemplate, len(o.templates))}
	for _, t := range o.templates {
		if _, dup := e.templates[t.Operation]; dup {
			return nil, fmt.Errorf("policy template %q: duplicate operation", t.Operation)
		}
		ct, err := compileTemplate(t, o.limits)
		if err != nil {
			return nil, fmt.Errorf("policy template %q: %w", t.Operation, err)
		}
		e.templates[t.Operation] = ct
	}
	return e, nil
}

func compileTemplate(t *Template, limits Limits) (*compiledTemplate, error) {
	if err := t.validate(); err != nil {
		return nil, err
	}
	leaves, err := t.Context.leaves()
	if err != nil {
		return nil, err
	}
	env, err := newEnv(t, leaves, false)
	if err != nil {
		return nil, err
	}
	configEnv, err := newEnv(t, nil, true)
	if err != nil {
		return nil, err
	}
	ct := &compiledTemplate{Template: t, leaves: leaves}
	for _, rule := range t.Rules {
		cr, err := compileRule(env, rule, limits)
		if err != nil {
			return nil, err
		}
		// One setting per rule, named after it: the rule name is then the
		// key of both the violation and the constraint, and its value is
		// that setting. A rule reading no setting would have to run without
		// an instance, which "only what is configured is enforced" rules out
		// for now.
		if len(cr.reads) != 1 || cr.reads[0] != rule.Name {
			return nil, fmt.Errorf("rule %q: must read exactly the setting it is named after, reads %v", rule.Name, cr.reads)
		}
		ct.rules = append(ct.rules, cr)
	}
	for _, rule := range t.ConfigRules {
		cr, err := compileRule(configEnv, rule, limits)
		if err != nil {
			return nil, fmt.Errorf("config %w", err)
		}
		if len(cr.reads) == 0 {
			return nil, fmt.Errorf("config rule %q: reads no setting", rule.Name)
		}
		ct.configRules = append(ct.configRules, cr)
	}
	return ct, nil
}

// Operations lists the catalogued operations, sorted.
func (e *Engine) Operations() []string {
	return slices.Sorted(maps.Keys(e.templates))
}

// Template returns the template for an operation.
func (e *Engine) Template(operation string) (*Template, error) {
	ct, err := e.template(operation)
	if err != nil {
		return nil, err
	}
	return ct.Template, nil
}

func (e *Engine) template(operation string) (*compiledTemplate, error) {
	ct, ok := e.templates[operation]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownOperation, operation)
	}
	return ct, nil
}

// ValidateInstance checks an instance against its template: a known
// operation, known settings, values of the right type within bounds, and
// every config rule whose settings are all set. This is what publishing an
// instance and validating a release run. An empty config is valid and
// switches every rule off.
func (e *Engine) ValidateInstance(inst *Instance) error {
	ct, err := e.template(inst.Operation)
	if err != nil {
		return err
	}
	values, err := settingValues(ct.Template, inst.Config)
	if err != nil {
		return err
	}
	vars := configActivation(values)
	var problems []error
	for _, rule := range ct.configRules {
		if !rule.active(values) {
			continue
		}
		held, err := rule.eval(context.Background(), vars)
		if err != nil {
			return err
		}
		if !held {
			problems = append(problems, fmt.Errorf("config rule %q does not hold", rule.Name))
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("%w: %w", ErrInvalidInstance, errors.Join(problems...))
	}
	return nil
}

// Decision is the outcome of one evaluation. Allow is false when the
// operation must be rejected; Violations maps every failed rule to the value
// of the setting it is named after, so a client renders "at least 12
// characters" from {"min_length": 12}.
type Decision struct {
	Allow      bool           `json:"allow"`
	Violations map[string]any `json:"violations,omitempty"`
}

// Evaluate runs every active rule of the instance's operation over its
// settings and the given context. All active rules run; there is no
// short-circuit, so a user sees every requirement missed.
//
// A nil instance, or one setting nothing, has no active rule and allows
// without reading the context. Otherwise a context that does not match the
// template's schema is an error, never a silent allow.
func (e *Engine) Evaluate(ctx context.Context, operation string, inst *Instance, requestContext map[string]any) (Decision, error) {
	ct, err := e.template(operation)
	if err != nil {
		return Decision{}, err
	}
	values, err := ct.instanceValues(inst)
	if err != nil {
		return Decision{}, err
	}
	var active []*compiledRule
	for _, rule := range ct.rules {
		if rule.active(values) {
			active = append(active, rule)
		}
	}
	if len(active) == 0 {
		return Decision{Allow: true}, nil
	}
	vars, err := ct.activation(values, requestContext)
	if err != nil {
		return Decision{}, err
	}
	var violations map[string]any
	for _, rule := range active {
		held, err := rule.eval(ctx, vars)
		if err != nil {
			return Decision{}, err
		}
		if !held {
			if violations == nil {
				violations = make(map[string]any, len(active))
			}
			violations[rule.Name] = values[rule.Name]
		}
	}
	return Decision{Allow: len(violations) == 0, Violations: violations}, nil
}

// Constraints is the pre-auth projection of a policy: every active rule
// keyed by name with the value of its setting. It needs no request context,
// so a login form can render the requirements before the user types. With
// no instance, Rules is empty.
type Constraints struct {
	Operation string         `json:"operation"`
	Rules     map[string]any `json:"rules"`
}

// Constraints computes the projection for an instance, which may be nil.
func (e *Engine) Constraints(operation string, inst *Instance) (Constraints, error) {
	ct, err := e.template(operation)
	if err != nil {
		return Constraints{}, err
	}
	values, err := ct.instanceValues(inst)
	if err != nil {
		return Constraints{}, err
	}
	out := Constraints{Operation: operation, Rules: make(map[string]any, len(ct.rules))}
	for _, rule := range ct.rules {
		if rule.active(values) {
			out.Rules[rule.Name] = values[rule.Name]
		}
	}
	return out, nil
}

// instanceValues returns the instance's settings in canonical types. A nil
// instance sets nothing.
func (ct *compiledTemplate) instanceValues(inst *Instance) (map[string]any, error) {
	if inst == nil {
		return nil, nil
	}
	if inst.Operation != ct.Operation {
		return nil, fmt.Errorf("%w: instance is for %q, not %q", ErrInvalidInstance, inst.Operation, ct.Operation)
	}
	return settingValues(ct.Template, inst.Config)
}

// active reports whether every setting the rule reads is set.
func (r *compiledRule) active(values map[string]any) bool {
	for _, name := range r.reads {
		if _, ok := values[name]; !ok {
			return false
		}
	}
	return true
}

func (r *compiledRule) eval(ctx context.Context, vars map[string]any) (bool, error) {
	out, _, err := r.program.ContextEval(ctx, vars)
	if err != nil {
		return false, fmt.Errorf("rule %q: %w", r.Name, err)
	}
	held, ok := out.Value().(bool)
	if !ok {
		return false, fmt.Errorf("rule %q: returned %s, expected bool", r.Name, out.Type())
	}
	return held, nil
}

func configActivation(values map[string]any) map[string]any {
	vars := make(map[string]any, len(values))
	for name, value := range values {
		vars[configVariable+"."+name] = value
	}
	return vars
}

// activation flattens the settings and the request context along the
// template's schema into the dotted variable names the rules were compiled
// against, rejecting a missing or mistyped field.
func (ct *compiledTemplate) activation(values map[string]any, requestContext map[string]any) (map[string]any, error) {
	vars := configActivation(values)
	for _, leaf := range ct.leaves {
		value, ok := lookupPath(requestContext, leaf.path)
		if !ok {
			return nil, fmt.Errorf("%w: missing field %q", ErrContextMismatch, leaf.path)
		}
		typed, err := coerceContext(leaf, value)
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrContextMismatch, err)
		}
		vars[leaf.path] = typed
	}
	return vars, nil
}

func lookupPath(m map[string]any, path string) (any, bool) {
	var cur any = m
	start := 0
	for i := 0; i <= len(path); i++ {
		if i < len(path) && path[i] != '.' {
			continue
		}
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = obj[path[start:i]]
		if !ok {
			return nil, false
		}
		start = i + 1
	}
	return cur, true
}

// coerceContext checks one context value against its declared type and
// returns it as a value CEL accepts for that type.
func coerceContext(leaf contextField, value any) (any, error) {
	switch leaf.typ {
	case "int":
		n, ok := toInt64(value)
		if !ok {
			return nil, fmt.Errorf("field %q: expected int, got %T", leaf.path, value)
		}
		return n, nil
	case "bool":
		b, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("field %q: expected bool, got %T", leaf.path, value)
		}
		return b, nil
	case "string":
		s, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("field %q: expected string, got %T", leaf.path, value)
		}
		return s, nil
	case "list<bool>":
		return coerceList[bool](leaf, value)
	case "list<string>":
		return coerceList[string](leaf, value)
	case "list<int>":
		items, err := coerceList[any](leaf, value)
		if err != nil {
			return nil, err
		}
		out := make([]int64, len(items))
		for i, item := range items {
			n, ok := toInt64(item)
			if !ok {
				return nil, fmt.Errorf("field %q[%d]: expected int, got %T", leaf.path, i, item)
			}
			out[i] = n
		}
		return out, nil
	}
	return nil, fmt.Errorf("field %q: unsupported type %q", leaf.path, leaf.typ)
}

func coerceList[T any](leaf contextField, value any) ([]T, error) {
	switch v := value.(type) {
	case []T:
		return v, nil
	case []any:
		out := make([]T, len(v))
		for i, item := range v {
			typed, ok := item.(T)
			if !ok {
				return nil, fmt.Errorf("field %q[%d]: expected %T, got %T", leaf.path, i, typed, item)
			}
			out[i] = typed
		}
		return out, nil
	case nil:
		return []T{}, nil
	}
	return nil, fmt.Errorf("field %q: expected a list, got %T", leaf.path, value)
}
