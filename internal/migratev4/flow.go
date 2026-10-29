package migratev4

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// Step names the SSO wiring adds, as the CLI's `auth-method sso enable` writes
// them (apps/cli/src/lib/idp/documents.ts).
const (
	stepRegisterSSO = "register-sso"
	stepSSOConflict = "sso-conflict"
	stepPassword    = "password"
)

// loginFlowWithSSO offers the providers on a login flow document the way
// `zitadel auth-method sso enable` does for the shipped flow: every entry step
// and the password step list the providers and route what comes back from
// one; register-sso collects what a provider did not supply; sso-conflict
// handles an email that already has an account.
//
// It expects the shipped flow's shape. The migrator only rewrites a login flow
// of a project it created, which starts as the shipped one.
func loginFlowWithSSO(document []byte, slugs []string) ([]byte, error) {
	var flow map[string]any
	if err := json.Unmarshal(document, &flow); err != nil {
		return nil, fmt.Errorf("parse the login flow: %w", err)
	}
	steps, _ := flow["steps"].([]any)
	byName := map[string]map[string]any{}
	var terminal string
	for _, s := range steps {
		step, ok := s.(map[string]any)
		if !ok {
			continue
		}
		name, _ := step["name"].(string)
		byName[name] = step
		if step["complete"] != nil {
			terminal = name
		}
	}
	if terminal == "" {
		return nil, fmt.Errorf("the login flow has no terminal step")
	}
	purposes, _ := flow["purposes"].(map[string]any)
	loginEntry, _ := purposes["login"].(string)

	routes := map[string]string{
		"sso_authenticated":   terminal,
		"sso_user_not_found":  stepRegisterSSO,
		"user_already_exists": stepSSOConflict,
	}
	offer := func(step map[string]any) {
		providers, _ := step["sso_providers"].([]any)
		for _, slug := range slugs {
			if !slices.Contains(providers, any(slug)) {
				providers = append(providers, slug)
			}
		}
		step["sso_providers"] = providers
		transitions, _ := step["transitions"].(map[string]any)
		if transitions == nil {
			transitions = map[string]any{}
		}
		for outcome, target := range routes {
			transitions[outcome] = map[string]any{"target": target}
		}
		step["transitions"] = transitions
	}

	entries := []string{}
	for _, name := range []string{loginEntry, stringOf(purposes["register"]), "identifier", "register"} {
		if name != "" && byName[name] != nil && !slices.Contains(entries, name) {
			entries = append(entries, name)
		}
	}
	for _, name := range entries {
		offer(byName[name])
	}
	if password := byName[stepPassword]; password != nil && !slices.Contains(entries, stepPassword) {
		offer(password)
	}
	if registerPassword := byName["register-password"]; registerPassword != nil {
		transitions, _ := registerPassword["transitions"].(map[string]any)
		if transitions == nil {
			transitions = map[string]any{}
		}
		transitions["user_already_exists"] = map[string]any{"target": stepSSOConflict}
		registerPassword["transitions"] = transitions
	}

	var added []any
	if byName[stepRegisterSSO] == nil {
		added = append(added, registerSSOStep(registrationFields(byName, stringOf(purposes["register"])), terminal))
	}
	if conflict := byName[stepSSOConflict]; conflict == nil {
		added = append(added, ssoConflictStep(slugs, loginEntry, terminal))
	} else {
		offer(conflict)
	}
	if len(added) > 0 {
		at := len(steps)
		for i, s := range steps {
			if step, ok := s.(map[string]any); ok && step["name"] == terminal {
				at = i
				break
			}
		}
		steps = slices.Insert(steps, at, added...)
	}
	flow["steps"] = steps
	return json.Marshal(flow)
}

// registrationFields are the properties the register step collects, without
// credentials: what register-sso asks for when the provider's claims fall short.
func registrationFields(byName map[string]map[string]any, registerStep string) []any {
	for _, name := range []string{registerStep, "register", "identifier"} {
		step := byName[name]
		if step == nil {
			continue
		}
		fields, _ := step["fields"].([]any)
		var collected []any
		for _, field := range fields {
			if s, ok := field.(string); ok && !strings.HasPrefix(s, "x-auth-methods#") {
				collected = append(collected, s)
			}
		}
		if len(collected) > 0 {
			return collected
		}
	}
	return []any{}
}

func registerSSOStep(fields []any, terminal string) map[string]any {
	return map[string]any{
		"name":   stepRegisterSSO,
		"fields": fields,
		"actions": []any{
			map[string]any{"name": "submit", "kind": "submit", "primary": true, "text_key": stepRegisterSSO + ".action.submit"},
		},
		"on_success": "create_user_with_sso",
		"transitions": map[string]any{
			"submit":              map[string]any{"target": terminal},
			"user_already_exists": map[string]any{"target": stepSSOConflict},
		},
	}
}

func ssoConflictStep(slugs []string, loginEntry, terminal string) map[string]any {
	actions := []any{
		map[string]any{"name": "submit", "kind": "submit", "primary": true, "text_key": stepSSOConflict + ".action.submit"},
		map[string]any{"name": "passkey", "kind": "passkey", "primary": false, "text_key": stepSSOConflict + ".action.passkey"},
	}
	transitions := map[string]any{
		"submit":              map[string]any{"target": terminal},
		"passkey":             map[string]any{"target": terminal},
		"sso_authenticated":   map[string]any{"target": terminal},
		"user_already_exists": map[string]any{"target": stepSSOConflict},
		"sso_user_not_found":  map[string]any{"target": stepRegisterSSO},
	}
	if loginEntry != "" {
		actions = append(actions, map[string]any{"name": "sign_in", "kind": "navigate", "primary": false, "text_key": stepSSOConflict + ".action.sign_in"})
		transitions["sign_in"] = map[string]any{"target": loginEntry, "purpose": "login"}
	}
	providers := make([]any, 0, len(slugs))
	for _, slug := range slugs {
		providers = append(providers, slug)
	}
	return map[string]any{
		"name":          stepSSOConflict,
		"fields":        []any{"x-auth-methods#password"},
		"actions":       actions,
		"sso_providers": providers,
		"transitions":   transitions,
	}
}

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}
