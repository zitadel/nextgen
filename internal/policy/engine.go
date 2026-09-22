package policy

import (
	"context"
	"fmt"
	"maps"
	"slices"

	"cel.dev/cel-go/cel"
)

// Engine holds every compiled template and evaluates instances against
// request contexts. It is stateless: it never fetches its own inputs.
type Engine struct {
	templates map[string]*compiledTemplate
	limits    Limits
}

type compiledTemplate struct {
	*Template
	env    *cel.Env
	rules  []*compiledRule
	leaves []contextField
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
// template's config and context, and checked against the limits, so a
// template the server cannot evaluate fails here rather than at the first
// request.
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
	e := &Engine{
		templates: make(map[string]*compiledTemplate, len(o.templates)),
		limits:    o.limits,
	}
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
	env, err := newEnv(t)
	if err != nil {
		return nil, err
	}
	leaves, err := t.Context.leaves()
	if err != nil {
		return nil, err
	}
	ct := &compiledTemplate{Template: t, env: env, leaves: leaves}
	for _, rule := range t.Rules {
		cr, err := compileRule(env, rule, limits)
		if err != nil {
			return nil, err
		}
		ct.rules = append(ct.rules, cr)
	}
	return ct, nil
}

// Operations lists the catalogued operations, sorted.
func (e *Engine) Operations() []string {
	return slices.Sorted(maps.Keys(e.templates))
}

// Template returns the template for an operation.
func (e *Engine) Template(operation string) (*Template, error) {
	ct, ok := e.templates[operation]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownOperation, operation)
	}
	return ct.Template, nil
}

// DefaultInstance is the instance that applies when no document is authored:
// every setting at its template default, project-wide, enforced.
func (e *Engine) DefaultInstance(operation string) (*Instance, error) {
	t, err := e.Template(operation)
	if err != nil {
		return nil, err
	}
	cfg := make(map[string]any, len(t.Config))
	for name, setting := range t.Config {
		if setting.Fixed {
			continue // filled from the template; an instance never carries it
		}
		cfg[name] = setting.Default
	}
	return &Instance{
		Kind:      KindPolicy,
		Operation: operation,
		Config:    cfg,
	}, nil
}

// ValidateInstance checks an instance against its template: known operation,
// known settings, values within bounds. This is what release validation runs.
func (e *Engine) ValidateInstance(inst *Instance) error {
	ct, ok := e.templates[inst.Operation]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownOperation, inst.Operation)
	}
	_, err := effectiveConfig(ct.Template, inst)
	return err
}

// Warning flags a legal but discouraged value in an instance.
type Warning struct {
	Setting            string `json:"setting"`
	Value              int64  `json:"value"`
	RecommendedMinimum int64  `json:"recommended_minimum"`
}

// Warnings lists the settings an instance sets below their recommended
// minimum. The authoring workflow shows them; they never block.
func (e *Engine) Warnings(inst *Instance) ([]Warning, error) {
	ct, ok := e.templates[inst.Operation]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownOperation, inst.Operation)
	}
	cfg, err := effectiveConfig(ct.Template, inst)
	if err != nil {
		return nil, err
	}
	var out []Warning
	for _, name := range slices.Sorted(maps.Keys(ct.Config)) {
		setting := ct.Config[name]
		if setting.RecommendedMinimum == nil {
			continue
		}
		if value, ok := cfg[name].(int64); ok && value < *setting.RecommendedMinimum {
			out = append(out, Warning{Setting: name, Value: value, RecommendedMinimum: *setting.RecommendedMinimum})
		}
	}
	return out, nil
}

// Decision is the outcome of one evaluation: Allow is false when the
// operation must be rejected, and Violations are the rules that failed.
type Decision struct {
	Allow      bool        `json:"allow"`
	Violations []Violation `json:"violations,omitempty"`
}

// Violation names a failed rule and echoes the public settings it reads,
// which is what a client needs to render the requirement.
type Violation struct {
	Rule   string         `json:"rule"`
	Config map[string]any `json:"config,omitempty"`
}

// Evaluate runs every rule of the instance's operation over its effective
// config and the given context. All rules run; there is no short-circuit,
// so a user sees every requirement missed. A context that does not match the
// template's schema is an error, never a silent allow.
func (e *Engine) Evaluate(ctx context.Context, inst *Instance, requestContext map[string]any) (Decision, error) {
	ct, ok := e.templates[inst.Operation]
	if !ok {
		return Decision{}, fmt.Errorf("%w: %q", ErrUnknownOperation, inst.Operation)
	}
	cfg, err := effectiveConfig(ct.Template, inst)
	if err != nil {
		return Decision{}, err
	}
	violations, err := ct.evaluate(ctx, cfg, requestContext)
	if err != nil {
		return Decision{}, err
	}
	return Decision{Allow: len(violations) == 0, Violations: violations}, nil
}

// evaluate runs every rule over one config and returns the violations, in
// rule order.
func (ct *compiledTemplate) evaluate(ctx context.Context, cfg map[string]any, requestContext map[string]any) ([]Violation, error) {
	activation, err := ct.activation(cfg, requestContext)
	if err != nil {
		return nil, err
	}
	var violations []Violation
	for _, rule := range ct.rules {
		out, _, err := rule.program.ContextEval(ctx, activation)
		if err != nil {
			return nil, fmt.Errorf("rule %q: %w", rule.Name, err)
		}
		held, ok := out.Value().(bool)
		if !ok {
			return nil, fmt.Errorf("rule %q: returned %s, expected bool", rule.Name, out.Type())
		}
		if !held {
			violations = append(violations, Violation{Rule: rule.Name, Config: publicReads(ct.Template, rule, cfg)})
		}
	}
	return violations, nil
}

// Constraints is the pre-auth projection of a policy: every rule by name with
// the public settings it reads. It needs no request context, so a login form
// can render requirements before the user types. A rule is present because
// it exists, which is what keeps every denial discoverable.
type Constraints struct {
	Operation string                    `json:"operation"`
	Rules     map[string]map[string]any `json:"rules"`
}

// Constraints computes the projection for an instance.
func (e *Engine) Constraints(inst *Instance) (Constraints, error) {
	ct, ok := e.templates[inst.Operation]
	if !ok {
		return Constraints{}, fmt.Errorf("%w: %q", ErrUnknownOperation, inst.Operation)
	}
	cfg, err := effectiveConfig(ct.Template, inst)
	if err != nil {
		return Constraints{}, err
	}
	out := Constraints{Operation: inst.Operation, Rules: make(map[string]map[string]any, len(ct.rules))}
	for _, rule := range ct.rules {
		out.Rules[rule.Name] = publicReads(ct.Template, rule, cfg)
	}
	return out, nil
}

// publicReads returns the public settings a rule reads with their effective
// values. Never nil, so JSON renders `{}` for a rule with no public inputs.
func publicReads(t *Template, rule *compiledRule, cfg map[string]any) map[string]any {
	out := make(map[string]any, len(rule.reads))
	for _, name := range rule.reads {
		if t.Config[name].Public {
			out[name] = cfg[name]
		}
	}
	return out
}

// activation flattens the request context along the template's schema into
// the dotted variable names the rules were compiled against, rejecting a
// missing or mistyped field.
func (ct *compiledTemplate) activation(cfg map[string]any, requestContext map[string]any) (map[string]any, error) {
	vars := make(map[string]any, len(cfg)+len(ct.leaves))
	for name, value := range cfg {
		vars[configVariable+"."+name] = value
	}
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
	for segment := range splitPath(path) {
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = obj[segment]
		if !ok {
			return nil, false
		}
	}
	return cur, true
}

func splitPath(path string) func(yield func(string) bool) {
	return func(yield func(string) bool) {
		start := 0
		for i := 0; i <= len(path); i++ {
			if i == len(path) || path[i] == '.' {
				if !yield(path[start:i]) {
					return
				}
				start = i + 1
			}
		}
	}
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
	case "list<string>":
		return coerceList[string](leaf, value)
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
