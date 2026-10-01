package policy

import (
	"fmt"
	"slices"
	"strings"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/checker"
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
	// MaxListSize is the assumed upper bound on context lists when estimating
	// cost, since a list's length is unknown statically.
	MaxListSize uint64
}

// DefaultLimits are tuned for a handful of scalar comparisons per rule.
var DefaultLimits = Limits{
	MaxExpressionLength: 256,
	MaxEstimatedCost:    10_000,
	MaxRuntimeCost:      10_000,
	MaxListSize:         64,
}

// configVariable is the CEL namespace instance config is exposed under.
const configVariable = "config"

// compiledRule is one rule ready to evaluate.
type compiledRule struct {
	Rule
	program cel.Program
	// reads are the config settings the expression references, sorted; a
	// violation echoes the public ones.
	reads []string
}

// newEnv builds the CEL environment for one template: every config setting
// and every context leaf is a typed variable addressed by its dotted path.
// The library is deliberately minimal: CEL's standard functions plus the
// strings and lists extensions.
func newEnv(t *Template) (*cel.Env, error) {
	opts := []cel.EnvOption{
		ext.Strings(),
		ext.Lists(),
	}
	for name, setting := range t.Config {
		typ, err := settingCELType(setting.Type)
		if err != nil {
			return nil, fmt.Errorf("setting %q: %w", name, err)
		}
		opts = append(opts, cel.Variable(configVariable+"."+name, typ))
	}
	leaves, err := t.Context.leaves()
	if err != nil {
		return nil, err
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
	case SettingTypeString:
		return cel.StringType, nil
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
	if ast.OutputType() != cel.BoolType {
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
		cel.EvalOptions(cel.OptOptimize),
	)
	if err != nil {
		return nil, fmt.Errorf("rule %q: build program: %w", rule.Name, err)
	}
	return &compiledRule{
		Rule:    rule,
		program: program,
		reads:   configReads(ast),
	}, nil
}

// configReads lists the config settings an expression references, from the
// checked AST's resolved identifiers.
func configReads(ast *cel.Ast) []string {
	var out []string
	for _, ref := range ast.NativeRep().ReferenceMap() {
		if name, ok := strings.CutPrefix(ref.Name, configVariable+"."); ok && !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	slices.Sort(out)
	return out
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
