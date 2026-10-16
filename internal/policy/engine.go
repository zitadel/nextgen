package policy

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/maputil"
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
	leaves      map[string]contextField
}

// Option configures an [Engine].
type Option func(*options)

type options struct {
	limits    Limits
	templates []*Template
	replace   bool
}

// WithLimits overrides [DefaultLimits].
func WithLimits(l Limits) Option {
	return func(o *options) { o.limits = l }
}

// WithTemplates replaces the embedded catalog, also with an empty one. Tests
// use it; the server runs on the embedded templates.
func WithTemplates(ts ...*Template) Option {
	return func(o *options) {
		o.templates = ts
		o.replace = true
	}
}

// New compiles the catalog. Every rule is type-checked against its
// template's settings and context and checked against the limits, every rule
// must read exactly one setting and carry its name, and every setting must be
// read by its rule, so a template the server cannot evaluate, or whose
// violations clients could not key, fails here rather than at the first
// request.
func New(opts ...Option) (*Engine, error) {
	o := options{limits: DefaultLimits}
	for _, opt := range opts {
		opt(&o)
	}
	if !o.replace {
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
		ct, err := compileTemplate(t.clone(), o.limits)
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
	ct := &compiledTemplate{Template: t, leaves: make(map[string]contextField, len(leaves))}
	for _, leaf := range leaves {
		ct.leaves[leaf.path] = leaf
	}
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
		// The reference map also names comprehension variables (`m`,
		// `@result`); only declared context fields are inputs.
		cr.contextReads = slices.DeleteFunc(cr.contextReads, func(path string) bool {
			_, declared := ct.leaves[path]
			return !declared
		})
		ct.rules = append(ct.rules, cr)
	}
	// The other direction: a setting no rule reads could be set and
	// published and would do nothing.
	for name := range t.Config {
		if !slices.ContainsFunc(ct.rules, func(r *compiledRule) bool { return r.Name == name }) {
			return nil, fmt.Errorf("setting %q: no rule reads it", name)
		}
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

// Template returns a copy of the template for an operation.
func (e *Engine) Template(operation string) (*Template, error) {
	ct, err := e.template(operation)
	if err != nil {
		return nil, err
	}
	return ct.Template.clone(), nil
}

func (e *Engine) template(operation string) (*compiledTemplate, error) {
	ct, ok := e.templates[operation]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownOperation, operation)
	}
	return ct, nil
}

// Bound is an instance checked against its template and ready to evaluate:
// its settings in canonical types and the rules they switch on. Bind it once
// when the instance is resolved and evaluate it per request.
//
// Only [Engine.Bind] makes a usable Bound: the zero value, or a nil one, is
// refused by [Bound.Evaluate] and [Bound.Constraints] rather than read as
// "no rule is active", which would allow everything.
type Bound struct {
	ct         *compiledTemplate
	values     map[string]any
	configVars map[string]any
	active     []*compiledRule
}

// Bind checks an instance against the operation's template: known settings,
// values of the right type within bounds, and every config rule whose
// settings are all set. A nil instance binds to no active rule. Publishing an
// instance and validating a release run the same check through
// [Engine.ValidateInstance].
func (e *Engine) Bind(ctx context.Context, operation string, inst *Instance) (*Bound, error) {
	ct, err := e.template(operation)
	if err != nil {
		return nil, err
	}
	b := &Bound{ct: ct, configVars: map[string]any{}}
	if inst == nil {
		return b, nil
	}
	if inst.Operation != operation {
		return nil, fmt.Errorf("%w: instance is for %q, not %q", ErrInvalidInstance, inst.Operation, operation)
	}
	b.values, err = settingValues(ct.Template, inst.Config)
	if err != nil {
		return nil, err
	}
	b.configVars = configActivation(b.values)
	var problems []error
	for _, rule := range ct.configRules {
		if !rule.active(b.values) {
			continue
		}
		held, err := rule.eval(ctx, b.configVars)
		if err != nil {
			return nil, err
		}
		if !held {
			problems = append(problems, fmt.Errorf("config rule %q does not hold", rule.Name))
		}
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("%w: %w", ErrInvalidInstance, errors.Join(problems...))
	}
	for _, rule := range ct.rules {
		if rule.active(b.values) {
			b.active = append(b.active, rule)
		}
	}
	return b, nil
}

// ValidateInstance runs [Engine.Bind] for the instance's own operation and
// keeps only the verdict. An empty config is valid and switches every rule
// off.
func (e *Engine) ValidateInstance(ctx context.Context, inst *Instance) error {
	_, err := e.Bind(ctx, inst.Operation, inst)
	return err
}

func (b *Bound) bound() bool {
	return b != nil && b.ct != nil
}

// Operation is the operation the instance guards, empty for an unbound
// value.
func (b *Bound) Operation() string {
	if !b.bound() {
		return ""
	}
	return b.ct.Operation
}

// Active reports whether a rule is switched on. A context builder asks it
// before deriving an expensive field only that rule reads.
func (b *Bound) Active(rule string) bool {
	return b.bound() && slices.ContainsFunc(b.active, func(r *compiledRule) bool { return r.Name == rule })
}

// Decision is the outcome of one evaluation. Allow is false when the
// operation must be rejected; Violations maps every failed rule to the value
// of the setting it is named after, so a client renders "at least 12
// characters" from {"min_length": 12}.
type Decision struct {
	Allow      bool           `json:"allow"`
	Violations map[string]any `json:"violations,omitempty"`
}

// Evaluate runs every active rule over the settings and the request context.
// All active rules run; there is no short-circuit, so a user sees every
// requirement missed.
//
// Only the context fields an active rule reads are required; with no active
// rule the context is not read at all. A required field that is missing,
// nil or mistyped is an error, never a silent allow.
func (b *Bound) Evaluate(ctx context.Context, requestContext map[string]any) (Decision, error) {
	if !b.bound() {
		return Decision{}, ErrUnbound
	}
	if len(b.active) == 0 {
		return Decision{Allow: true}, nil
	}
	vars := maps.Clone(b.configVars)
	for _, rule := range b.active {
		for _, path := range rule.contextReads {
			if _, done := vars[path]; done {
				continue
			}
			leaf := b.ct.leaves[path]
			value, err := lookupLeaf(requestContext, leaf)
			if err != nil {
				return Decision{}, err
			}
			typed, err := coerceContext(leaf, value)
			if err != nil {
				return Decision{}, fmt.Errorf("%w: %w", ErrContextMismatch, err)
			}
			vars[path] = typed
		}
	}
	var violations map[string]any
	for _, rule := range b.active {
		held, err := rule.eval(ctx, vars)
		if err != nil {
			return Decision{}, err
		}
		if !held {
			if violations == nil {
				violations = make(map[string]any, len(b.active))
			}
			violations[rule.Name] = b.values[rule.Name]
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

// Constraints computes the projection.
func (b *Bound) Constraints() (Constraints, error) {
	if !b.bound() {
		return Constraints{}, ErrUnbound
	}
	out := Constraints{Operation: b.ct.Operation, Rules: make(map[string]any, len(b.active))}
	for _, rule := range b.active {
		out.Rules[rule.Name] = b.values[rule.Name]
	}
	return out, nil
}

// lookupLeaf reads one context field. When the field is absent it says
// whether the field or an object on its path is missing, or whether a value
// on the path is not an object (a typed Go map such as map[string]int is
// not one), so a broken builder is easy to find.
func lookupLeaf(requestContext map[string]any, leaf contextField) (any, error) {
	if value, ok := maputil.GetNested[any](requestContext, leaf.segments); ok {
		return value, nil
	}
	var cur any = requestContext
	for i, segment := range leaf.segments {
		obj, ok := cur.(map[string]any)
		if !ok {
			parent := strings.Join(leaf.segments[:i], ".")
			return nil, fmt.Errorf("%w: field %q is not an object, got %T", ErrContextMismatch, parent, cur)
		}
		if cur, ok = obj[segment]; !ok || cur == nil {
			return nil, fmt.Errorf("%w: missing field %q", ErrContextMismatch, strings.Join(leaf.segments[:i+1], "."))
		}
	}
	return nil, fmt.Errorf("%w: missing field %q", ErrContextMismatch, leaf.path)
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
	vars := make(map[string]any, len(values)+2)
	for name, value := range values {
		vars[configVariable+"."+name] = value
	}
	return vars
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
		switch v := value.(type) {
		case []int64:
			return v, nil
		case []int:
			out := make([]int64, len(v))
			for i, n := range v {
				out[i] = int64(n)
			}
			return out, nil
		case []any:
			out := make([]int64, len(v))
			for i, item := range v {
				n, ok := toInt64(item)
				if !ok {
					return nil, fmt.Errorf("field %q[%d]: expected int, got %T", leaf.path, i, item)
				}
				out[i] = n
			}
			return out, nil
		}
		return nil, fmt.Errorf("field %q: expected a list of int, got %T", leaf.path, value)
	}
	return nil, fmt.Errorf("field %q: unsupported type %q", leaf.path, leaf.typ)
}

// coerceList accepts a typed slice or a JSON-decoded one. An untyped nil is
// not an empty list: a builder that forgot the field fails closed.
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
	}
	return nil, fmt.Errorf("field %q: expected a list, got %T", leaf.path, value)
}
