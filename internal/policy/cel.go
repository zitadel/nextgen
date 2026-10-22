package policy

import (
	"fmt"
	"slices"
	"strings"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/checker"
	celast "cel.dev/cel-go/common/ast"
	"cel.dev/cel-go/common/types"
	"cel.dev/cel-go/ext"
)

// Limits bound what a rule may cost. They are checked once per rule when the
// engine is built (expression length, statically estimated cost) and once per
// evaluation (runtime cost). Kubernetes enforces the same pair for admission
// policies; OpenFGA caps condition cost at 100.
type Limits struct {
	// MaxExpressionLength caps the source length of one rule in bytes.
	MaxExpressionLength int
	// MaxEstimatedCost caps the worst-case static cost estimate of one rule.
	MaxEstimatedCost uint64
	// MaxRuntimeCost caps the tracked cost of one rule evaluation.
	MaxRuntimeCost uint64
	// MaxListSize is the assumed upper bound on context lists and strings
	// when estimating cost, since their length is unknown statically.
	MaxListSize uint64
}

// DefaultLimits are sized for a handful of scalar comparisons per rule. The
// password rules estimate well under a tenth of the cost cap. A function
// rather than a variable, so no importer can change them for everyone.
func DefaultLimits() Limits {
	return Limits{
		MaxExpressionLength: 256,
		MaxEstimatedCost:    10_000,
		MaxRuntimeCost:      10_000,
		MaxListSize:         64,
	}
}

// configVariable is the CEL namespace settings are exposed under.
const configVariable = "config"

// compiledRule is one rule ready to evaluate.
type compiledRule struct {
	Rule
	program cel.Program
	// reads are the settings the expression references, sorted.
	reads []string
	// ast is the checked expression, kept for the template-level checks.
	ast *cel.Ast
	// contextReads are the context fields the expression references, sorted.
	// Only the fields an active rule reads have to be in the request context.
	contextReads []string
}

// newEnv builds the CEL environment for one template: every setting and
// every given context leaf is a typed variable addressed by its dotted path.
// Config rules get no leaves, so a reference to the context fails to
// compile. The library is deliberately minimal: CEL's standard functions
// plus the strings and lists extensions.
func newEnv(t *Template, leaves []contextField) (*cel.Env, error) {
	opts := []cel.EnvOption{
		// Pinned, so a cel-go upgrade cannot add functions to the rule
		// environment unnoticed: strings v5 and lists v3 are the first
		// versions with cost estimates for their functions.
		ext.Strings(ext.StringsVersion(5)),
		ext.Lists(ext.ListsVersion(3)),
	}
	for name, setting := range t.Config {
		typ, err := settingCELType(setting.Type)
		if err != nil {
			return nil, fmt.Errorf("setting %q: %w", name, err)
		}
		opts = append(opts, cel.Variable(configVariable+"."+name, typ))
	}
	for _, leaf := range leaves {
		if leaf.path == configVariable || strings.HasPrefix(leaf.path, configVariable+".") {
			return nil, fmt.Errorf("context field %q: %q is reserved", leaf.path, configVariable)
		}
		typ, err := contextCELType(leaf.typ)
		if err != nil {
			return nil, fmt.Errorf("context field %q: %w", leaf.path, err)
		}
		opts = append(opts, cel.Variable(leaf.path, typ))
	}
	return cel.NewEnv(opts...)
}

func settingCELType(t SettingType) (*cel.Type, error) {
	switch t {
	case SettingTypeInteger:
		return cel.IntType, nil
	case SettingTypeBoolean:
		return cel.BoolType, nil
	}
	return nil, fmt.Errorf("unsupported setting type %q", t)
}

func contextCELType(name string) (*cel.Type, error) {
	if elem, ok := strings.CutPrefix(name, "list<"); ok {
		elem, ok = strings.CutSuffix(elem, ">")
		if !ok {
			return nil, fmt.Errorf("malformed list type %q", name)
		}
		elemType, err := contextCELType(elem)
		if err != nil {
			return nil, err
		}
		return cel.ListType(elemType), nil
	}
	switch name {
	case "int":
		return cel.IntType, nil
	case "bool":
		return cel.BoolType, nil
	case "string":
		return cel.StringType, nil
	}
	return nil, fmt.Errorf("unsupported context type %q", name)
}

// compileRule type-checks one rule against the environment, enforces the
// static limits and builds its program.
func compileRule(env *cel.Env, rule Rule, limits Limits) (*compiledRule, error) {
	if len(rule.Expression) > limits.MaxExpressionLength {
		return nil, fmt.Errorf("rule %q: expression is %d bytes, limit is %d", rule.Name, len(rule.Expression), limits.MaxExpressionLength)
	}
	ast, issues := env.Compile(rule.Expression)
	if issues != nil && issues.Err() != nil {
		return nil, fmt.Errorf("rule %q: %w", rule.Name, issues.Err())
	}
	if !ast.OutputType().IsExactType(cel.BoolType) {
		return nil, fmt.Errorf("rule %q: expression must evaluate to bool, got %s", rule.Name, ast.OutputType())
	}
	estimate, err := env.EstimateCost(ast, sizeEstimator{maxList: limits.MaxListSize})
	if err != nil {
		return nil, fmt.Errorf("rule %q: estimate cost: %w", rule.Name, err)
	}
	if estimate.Max > limits.MaxEstimatedCost {
		return nil, fmt.Errorf("rule %q: estimated cost %d exceeds the limit %d", rule.Name, estimate.Max, limits.MaxEstimatedCost)
	}
	program, err := env.Program(ast,
		cel.CostLimit(limits.MaxRuntimeCost),
		cel.InterruptCheckFrequency(100),
		cel.EvalOptions(cel.OptOptimize),
	)
	if err != nil {
		return nil, fmt.Errorf("rule %q: build program: %w", rule.Name, err)
	}
	reads, contextReads := references(ast)
	return &compiledRule{
		Rule:         rule,
		ast:          ast,
		program:      program,
		reads:        reads,
		contextReads: contextReads,
	}, nil
}

// references lists the settings and the other identifiers an expression
// references, from the checked AST's resolved identifiers. The second list
// can include comprehension variables; the caller keeps the declared context
// fields.
func references(ast *cel.Ast) (settings, contextFields []string) {
	for _, ref := range ast.NativeRep().ReferenceMap() {
		if ref.Name == "" {
			continue // a function overload, not a variable
		}
		if name, ok := strings.CutPrefix(ref.Name, configVariable+"."); ok {
			if !slices.Contains(settings, name) {
				settings = append(settings, name)
			}
			continue
		}
		if !slices.Contains(contextFields, ref.Name) {
			contextFields = append(contextFields, ref.Name)
		}
	}
	slices.Sort(settings)
	slices.Sort(contextFields)
	return settings, contextFields
}

// sizeEstimator bounds the size of context lists and strings, whose lengths
// are not known statically, so the cost estimate is finite.
type sizeEstimator struct {
	maxList uint64
}

var _ checker.CostEstimator = sizeEstimator{}

func (s sizeEstimator) EstimateSize(element checker.AstNode) *checker.SizeEstimate {
	switch element.Type().Kind() {
	case types.ListKind, types.StringKind:
		return &checker.SizeEstimate{Min: 0, Max: s.maxList}
	}
	return nil
}

func (s sizeEstimator) EstimateCallCost(_, _ string, _ *checker.AstNode, _ []checker.AstNode) *checker.CallEstimate {
	return nil
}

// shadowingVariables lists the comprehension variables of an expression
// that reuse the name of a declared input: `config`, or the first segment of
// a context field. Inside the comprehension such a name means the local
// variable, so the reference map would count an input the rule does not
// read, and a context without that field would be refused.
func shadowingVariables(ast *cel.Ast, inputs map[string]struct{}) []string {
	var out []string
	celast.PreOrderVisit(ast.NativeRep().Expr(), celast.NewExprVisitor(func(e celast.Expr) {
		if e.Kind() != celast.ComprehensionKind {
			return
		}
		comp := e.AsComprehension()
		for _, name := range []string{comp.IterVar(), comp.IterVar2()} {
			if _, taken := inputs[name]; taken && name != "" && !slices.Contains(out, name) {
				out = append(out, name)
			}
		}
	}))
	return out
}
