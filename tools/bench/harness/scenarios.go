package harness

import (
	"fmt"
	"slices"
	"strings"
)

// Scenario is one registered benchmark scenario: the name `sweep` and the
// entry script use, the operations it performs and whether it needs sessions.
// The registry is the single source of truth. The entry script builds its
// scenario table from it and the smoke lane runs whatever it lists, so a
// scenario added here is covered the moment it is registered, and one that
// silently stops being registered fails the lane instead of quietly leaving
// its coverage.
type Scenario struct {
	// Name is also the name of the exported function in the entry script.
	Name string
	// Ops are the operations an iteration performs, by operation id. The
	// smoke lane expects exactly these to produce samples.
	Ops []string
	// UsesSessions says the scenario takes sessions from the cache, which
	// must be warmed before anything is measured.
	UsesSessions bool
}

// Scenarios is the registry, in the order a sweep runs them.
var Scenarios = []Scenario{
	{Name: "login", Ops: []string{OpCreateFlow, OpSubmitIdent, OpSubmitPassword}},
	{Name: "getUser", Ops: []string{OpGetUser}},
	{Name: "getMySession", Ops: []string{OpGetMySession}, UsesSessions: true},
}

// ScenarioNames lists the registered scenarios.
func ScenarioNames() []string {
	names := make([]string, len(Scenarios))
	for i, s := range Scenarios {
		names[i] = s.Name
	}
	return names
}

// LookupScenario finds a registered scenario.
func LookupScenario(name string) (Scenario, bool) {
	i := slices.IndexFunc(Scenarios, func(s Scenario) bool { return s.Name == name })
	if i < 0 {
		return Scenario{}, false
	}
	return Scenarios[i], true
}

// ParseScenarios turns a comma separated list into registered scenario names.
// An empty list means every registered scenario.
func ParseScenarios(list string) ([]string, error) {
	if strings.TrimSpace(list) == "" {
		return ScenarioNames(), nil
	}
	var names []string
	for name := range strings.SplitSeq(list, ",") {
		name = strings.TrimSpace(name)
		if _, ok := LookupScenario(name); !ok {
			return nil, fmt.Errorf("unknown scenario %q; registered: %s", name, strings.Join(ScenarioNames(), ", "))
		}
		names = append(names, name)
	}
	return names, nil
}
