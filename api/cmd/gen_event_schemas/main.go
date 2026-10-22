// gen_event_schemas generates per-event-type OpenAPI schemas, the Event oneOf
// union with discriminator mapping, and a webhook per event type from
// domain.EventType constants.
//
// The webhooks describe what the event shipper POSTs to a webhook sink (ADR
// 049): one event per request, its body the event as GET /events returns it.
// The spec root lists them by hand, like its paths, and the generator fails
// until that list names exactly the domain's event types.
//
// Paths are relative to this generator:
//   - Domain: ../../../internal/domain/event.go
//   - Output: ../../openapi/endpoints/events/
//   - Spec root, checked: ../../openapi/openapi-spec.yaml
package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

// payloadByEventType maps every domain EventType string constant to a payload
// schema file under endpoints/events/payloads/. Shared payloads are intentional.
var payloadByEventType = map[string]string{
	"request.api": "request-api-payload.yaml",

	"project.created": "project-payload.yaml",
	"project.updated": "project-payload.yaml",
	"project.deleted": "empty-event-payload.yaml",

	"user.created":       "user-created-payload.yaml",
	"user.create.failed": "user-create-failed-payload.yaml",
	"user.updated":       "user-updated-payload.yaml",
	"user.deleted":       "empty-event-payload.yaml",

	"team.created":     "team-payload.yaml",
	"team.updated":     "team-payload.yaml",
	"team.deactivated": "empty-event-payload.yaml",

	"auth.token.issued":  "auth-token-issued-payload.yaml",
	"auth.token.revoked": "empty-event-payload.yaml",

	"session.established": "session-established-payload.yaml",
	"session.deleted":     "session-deleted-payload.yaml",

	"auth.attempt.created":    "empty-event-payload.yaml",
	"auth.attempt.handed_off": "empty-event-payload.yaml",
	"auth.check.failed":       "auth-check-payload.yaml",
	"auth.check.succeeded":    "auth-check-payload.yaml",

	"auth.sso.authorization.failed": "auth-check-payload.yaml",
	"auth.sso.exchange.succeeded":   "auth-check-payload.yaml",
	"auth.sso.exchange.failed":      "auth-check-payload.yaml",

	"flowdef.created": "flowdef-payload.yaml",
	"flowdef.updated": "flowdef-payload.yaml",
	"flowdef.deleted": "empty-event-payload.yaml",

	"schema.created": "schema-created-payload.yaml",

	"branding.created": "branding-created-payload.yaml",

	"policy.created": "policy-payload.yaml",
	"policy.updated": "policy-payload.yaml",

	"release.created": "release-created-payload.yaml",
	"release.revoked": "release-revoked-payload.yaml",

	"idp.created": "idp-payload.yaml",
	"idp.updated": "idp-payload.yaml",

	"idp.identity_link.created": "idp-identity-link-created-payload.yaml",

	"deployment.created": "deployment-created-payload.yaml",

	"origin.added":   "origin-payload.yaml",
	"origin.removed": "origin-payload.yaml",

	"variable.set":     "variable-set-payload.yaml",
	"variable.removed": "variable-removed-payload.yaml",

	"authz.granted": "authz-granted-payload.yaml",
	"authz.revoked": "authz-granted-payload.yaml",

	"auth.factor.password.set":     "auth-factor-payload.yaml",
	"auth.factor.passkey.enrolled": "auth-factor-payload.yaml",
}

// webhookTag groups the webhooks; the spec root declares it.
const webhookTag = "Event Webhooks"

// eventStatus says whether anything emits an event type, as the Path A/B,
// Retired, and Contracted sections of docs/design/api/events-catalog.md record.
type eventStatus int

const (
	statusLive eventStatus = iota
	// statusRetired: no producer any more; kept so stored rows decode.
	statusRetired
	// statusContracted: the contract is published before its producer lands.
	statusContracted
)

// webhookDoc is what an event type's webhook page says beyond its schema.
type webhookDoc struct {
	// description says what happened, for someone receiving the event.
	description string
	status      eventStatus
}

// webhookByEventType documents the webhook of every domain EventType constant.
var webhookByEventType = map[string]webhookDoc{
	"request.api": {description: "An API request in the project completed. One event per request; " +
		"the health, liveness, and readiness probes send none."},

	"project.created": {description: "A project was created."},
	"project.updated": {description: "A project was updated. The payload holds the fields that changed, " +
		"with their new values."},
	"project.deleted": {description: "A project was deleted."},

	"user.created": {description: "A user was created. The payload lists the attribute keys written, " +
		"with values only for schema fields marked `x-audit`."},
	"user.create.failed": {description: "Creating a user failed because a unique attribute was already taken."},
	"user.updated": {description: "A user's attributes were updated. The payload lists the attribute keys " +
		"written, with values only for schema fields marked `x-audit`."},
	"user.deleted": {description: "A user was deleted."},

	"team.created": {description: "A team was created."},
	"team.updated": {description: "A team was updated. The payload holds the fields that changed, " +
		"with their new values."},
	"team.deactivated": {description: "A team was deactivated."},

	"auth.token.issued": {description: "A token was issued."},
	"auth.token.revoked": {description: "A token was revoked. Deleting a session revokes its tokens too; " +
		"those events carry the session's `session_id` and no `entity_id`."},

	"session.established": {description: "A session was established, by a sign-in or by exchanging a session."},
	"session.deleted":     {description: "A session was revoked."},

	"auth.attempt.created":    {description: "An authentication attempt started."},
	"auth.attempt.handed_off": {description: "An authentication attempt was handed off to a session."},
	"auth.check.failed": {description: "A check in an authentication attempt failed, such as a wrong " +
		"password."},
	"auth.check.succeeded": {description: "A check in an authentication attempt succeeded. Also sent when " +
		"a factor is recorded without a challenge, as on sign-up."},

	"auth.sso.authorization.failed": {description: "The identity provider answered an SSO sign-in with an " +
		"error, `access_denied` included, or the callback carried no code."},
	"auth.sso.exchange.succeeded": {description: "The code an SSO sign-in returned was exchanged. This is " +
		"not a sign-in: the identity may still match no user."},
	"auth.sso.exchange.failed": {description: "An SSO sign-in failed after its code arrived: the token " +
		"exchange, the ID token or userinfo validation, or the connection's configuration failed."},

	"flowdef.created": {description: "A flow definition was created."},
	"flowdef.updated": {description: "A flow definition was updated.", status: statusRetired},
	"flowdef.deleted": {description: "A flow definition was deleted.", status: statusRetired},

	"schema.created": {description: "A schema was created."},

	"branding.created": {description: "A branding revision was created."},

	"policy.created": {description: "A project published the first revision of its policy for an operation."},
	"policy.updated": {description: "A project published a new revision of its policy for an operation. The " +
		"payload holds the new revision and its settings."},

	"release.created": {description: "A release was created."},
	"release.revoked": {description: "A release was revoked.", status: statusContracted},

	"idp.created": {description: "An identity provider connection was created."},
	"idp.updated": {description: "An identity provider connection was revised. The payload holds the new " +
		"revision and the fields that changed."},

	"idp.identity_link.created": {description: "A user was linked to an account at an identity provider, " +
		"by an SSO sign-in that created the user."},

	"deployment.created": {description: "A release was deployed, or a deployment rolled back. One event " +
		"per deployment, however many targets it has."},

	"origin.added":   {description: "An origin was added to a project."},
	"origin.removed": {description: "An origin was removed from a project."},

	"variable.set": {description: "A variable was given a value, new or replacing one. One event per kind " +
		"written; the value never appears."},
	"variable.removed": {description: "A variable's value was removed. One event per kind removed."},

	"authz.granted": {description: "A role on a project was granted."},
	"authz.revoked": {description: "A role on a project was revoked."},

	"auth.factor.password.set":     {description: "A user's password was set."},
	"auth.factor.passkey.enrolled": {description: "A passkey was enrolled for a user."},
}

func main() {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		fmt.Fprintln(os.Stderr, "Failed to get current file path")
		os.Exit(1)
	}
	generatorDir := filepath.Dir(filename)
	domainEventPath := filepath.Join(generatorDir, "../../../internal/domain/event.go")
	outDir := filepath.Join(generatorDir, "../../openapi/endpoints/events")
	typesDir := filepath.Join(outDir, "types")
	payloadsDir := filepath.Join(outDir, "payloads")
	webhooksDir := filepath.Join(outDir, "webhooks")
	specPath := filepath.Join(generatorDir, "../../openapi/openapi-spec.yaml")

	eventTypes, err := extractEventTypes(domainEventPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "extract event types: %v\n", err)
		os.Exit(1)
	}
	if err := validateMappings(eventTypes, payloadsDir); err != nil {
		fmt.Fprintf(os.Stderr, "payload map: %v\n", err)
		os.Exit(1)
	}
	if err := validateWebhookDocs(eventTypes); err != nil {
		fmt.Fprintf(os.Stderr, "webhook map: %v\n", err)
		os.Exit(1)
	}
	if err := checkSpecWebhooks(specPath, eventTypes); err != nil {
		fmt.Fprintf(os.Stderr, "spec webhooks: %v\n", err)
		os.Exit(1)
	}

	if err := os.MkdirAll(typesDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "mkdir types: %v\n", err)
		os.Exit(1)
	}

	// Remove previously generated type files so renames/deletes stay clean.
	if err := removeYAMLFiles(typesDir); err != nil {
		fmt.Fprintf(os.Stderr, "read types dir: %v\n", err)
		os.Exit(1)
	}

	sort.Strings(eventTypes)
	for _, et := range eventTypes {
		slug := eventTypeSlug(et)
		title := eventTypeTitle(et)
		payloadFile := payloadByEventType[et]
		content := fmt.Sprintf(`# Code generated by gen_event_schemas; DO NOT EDIT.
title: %s
description: |
  Wide event with event_type=%s.
allOf:
  - $ref: ../event-base.yaml
  - type: object
    required:
      - event_type
      - payload
    properties:
      event_type:
        type: string
        const: %s
      payload:
        $ref: ../payloads/%s
`, title, et, et, payloadFile)
		path := filepath.Join(typesDir, slug+".yaml")
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "write %s: %v\n", path, err)
			os.Exit(1)
		}
	}

	if err := writeEventUnion(outDir, eventTypes); err != nil {
		fmt.Fprintf(os.Stderr, "write event.yaml: %v\n", err)
		os.Exit(1)
	}

	if err := writeWebhooks(webhooksDir, eventTypes); err != nil {
		fmt.Fprintf(os.Stderr, "write webhooks: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Generated %d event type schemas and webhooks in %s\n", len(eventTypes), outDir)
}

func validateMappings(eventTypes []string, payloadsDir string) error {
	known := make(map[string]struct{}, len(eventTypes))
	for _, et := range eventTypes {
		known[et] = struct{}{}
		payloadFile, ok := payloadByEventType[et]
		if !ok {
			return fmt.Errorf("missing payload mapping for event type %q", et)
		}
		if _, err := os.Stat(filepath.Join(payloadsDir, payloadFile)); err != nil {
			return fmt.Errorf("payload file for %q: %w", et, err)
		}
	}
	for et := range payloadByEventType {
		if _, ok := known[et]; !ok {
			return fmt.Errorf("payload map has unknown event type %q (not in domain.EventType constants)", et)
		}
	}
	return nil
}

func validateWebhookDocs(eventTypes []string) error {
	known := make(map[string]struct{}, len(eventTypes))
	for _, et := range eventTypes {
		known[et] = struct{}{}
		doc, ok := webhookByEventType[et]
		if !ok {
			return fmt.Errorf("missing webhook description for event type %q", et)
		}
		if strings.TrimSpace(doc.description) == "" {
			return fmt.Errorf("empty webhook description for event type %q", et)
		}
	}
	for et := range webhookByEventType {
		if _, ok := known[et]; !ok {
			return fmt.Errorf("webhook map has unknown event type %q (not in domain.EventType constants)", et)
		}
	}
	return nil
}

// checkSpecWebhooks reports where the webhooks the spec root lists differ from
// the domain's event types. The root is written by hand, like its paths, so a
// new event type needs its entry there as well as the file generated here.
func checkSpecWebhooks(specPath string, eventTypes []string) error {
	raw, err := os.ReadFile(specPath)
	if err != nil {
		return err
	}
	var spec struct {
		Webhooks map[string]struct {
			Ref string `yaml:"$ref"`
		} `yaml:"webhooks"`
	}
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		return fmt.Errorf("parse %s: %w", specPath, err)
	}

	known := make(map[string]struct{}, len(eventTypes))
	var problems []string
	for _, et := range eventTypes {
		known[et] = struct{}{}
		want := webhookRef(et)
		listed, ok := spec.Webhooks[et]
		switch {
		case !ok:
			problems = append(problems, fmt.Sprintf("missing %s, with $ref: %s", et, want))
		case listed.Ref != want:
			problems = append(problems, fmt.Sprintf("%s has $ref: %s, want %s", et, listed.Ref, want))
		}
	}
	for name := range spec.Webhooks {
		if _, ok := known[name]; !ok {
			problems = append(problems, fmt.Sprintf("%s is not a domain event type", name))
		}
	}
	if len(problems) == 0 {
		return nil
	}
	sort.Strings(problems)
	return fmt.Errorf("%s does not list one webhook per event type:\n  %s",
		specPath, strings.Join(problems, "\n  "))
}

func writeEventUnion(outDir string, eventTypes []string) error {
	var buf bytes.Buffer
	buf.WriteString(`# Code generated by gen_event_schemas; DO NOT EDIT.
description: |
  Discriminated wide-event union (ADR 048 / ADR 049). Clients select the
  member via event_type; each member carries a typed payload.
oneOf:
`)
	for _, et := range eventTypes {
		fmt.Fprintf(&buf, "  - $ref: types/%s.yaml\n", eventTypeSlug(et))
	}
	buf.WriteString(`discriminator:
  propertyName: event_type
  mapping:
`)
	for _, et := range eventTypes {
		fmt.Fprintf(&buf, "    %s: types/%s.yaml\n", et, eventTypeSlug(et))
	}
	return os.WriteFile(filepath.Join(outDir, "event.yaml"), buf.Bytes(), 0o644)
}

// writeWebhooks writes one webhook per event type: the request the shipper
// sends a webhook sink to deliver an event of that type.
func writeWebhooks(webhooksDir string, eventTypes []string) error {
	if err := os.MkdirAll(webhooksDir, 0o755); err != nil {
		return err
	}
	// Remove previously generated webhooks so renames/deletes stay clean.
	if err := removeYAMLFiles(webhooksDir); err != nil {
		return err
	}
	for _, et := range eventTypes {
		path := filepath.Join(webhooksDir, webhookFileName(et))
		if err := os.WriteFile(path, []byte(webhookYAML(et, webhookByEventType[et])), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func webhookYAML(et string, doc webhookDoc) string {
	paragraphs := []string{doc.description}
	switch doc.status {
	case statusRetired:
		paragraphs = append(paragraphs, "Retired: nothing sends this event any more. It stays in the API so "+
			"stored events still decode.")
	case statusContracted:
		paragraphs = append(paragraphs, "Not sent yet: the contract is published ahead of the code that "+
			"sends it.")
	}
	paragraphs = append(paragraphs, "The body is the event as `GET /events` returns it.")

	var buf bytes.Buffer
	fmt.Fprintf(&buf, `# Code generated by gen_event_schemas; DO NOT EDIT.
post:
  operationId: %s
  summary: %s
  description: |
`, webhookOperationID(et), et)
	for i, paragraph := range paragraphs {
		if i > 0 {
			buf.WriteString("\n")
		}
		for _, line := range wrapText(paragraph, 72) {
			fmt.Fprintf(&buf, "    %s\n", line)
		}
	}
	fmt.Fprintf(&buf, "  tags:\n    - %s\n", webhookTag)
	if doc.status == statusRetired {
		buf.WriteString("  deprecated: true\n")
	}
	// The shipper sends no credentials and signs nothing.
	fmt.Fprintf(&buf, `  security: []
  requestBody:
    required: true
    content:
      application/json:
        schema:
          $ref: ../types/%s.yaml
  responses:
    '2XX':
      description: Delivered. Any 2xx status acknowledges the event; the response body is ignored.
    default:
      description: |
        Not delivered: any other status, a failed connection, or a timeout.
        The server sends the event again on its next pass, and holds back the
        project's later events until this one is delivered.
`, eventTypeSlug(et))
	return buf.String()
}

// webhookRef is the $ref by which the spec root lists an event type's webhook.
func webhookRef(et string) string {
	return "endpoints/events/webhooks/" + webhookFileName(et)
}

func webhookFileName(et string) string {
	return strings.ReplaceAll(et, ".", "-") + ".yaml"
}

// webhookOperationID writes the event type the way the API's operation ids
// are written: auth.attempt.handed_off is authAttemptHandedOff.
func webhookOperationID(et string) string {
	var b strings.Builder
	for i, part := range strings.FieldsFunc(et, func(r rune) bool { return r == '.' || r == '_' }) {
		if i > 0 {
			part = strings.ToUpper(part[:1]) + part[1:]
		}
		b.WriteString(part)
	}
	return b.String()
}

// wrapText breaks s at spaces into lines of at most width bytes, unless a
// single word is longer.
func wrapText(s string, width int) []string {
	var lines []string
	var line strings.Builder
	for _, word := range strings.Fields(s) {
		if line.Len() > 0 && line.Len()+1+len(word) > width {
			lines = append(lines, line.String())
			line.Reset()
		}
		if line.Len() > 0 {
			line.WriteByte(' ')
		}
		line.WriteString(word)
	}
	if line.Len() > 0 {
		lines = append(lines, line.String())
	}
	return lines
}

// removeYAMLFiles deletes the YAML files directly in dir.
func removeYAMLFiles(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		_ = os.Remove(filepath.Join(dir, e.Name()))
	}
	return nil
}

func extractEventTypes(path string) ([]string, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, nil, 0)
	if err != nil {
		return nil, err
	}
	var out []string
	ast.Inspect(file, func(n ast.Node) bool {
		genDecl, ok := n.(*ast.GenDecl)
		if !ok || genDecl.Tok != token.CONST {
			return true
		}
		for _, spec := range genDecl.Specs {
			valueSpec, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, name := range valueSpec.Names {
				if !strings.HasPrefix(name.Name, "EventType") || name.Name == "EventType" {
					continue
				}
				if i >= len(valueSpec.Values) {
					continue
				}
				lit, ok := valueSpec.Values[i].(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					continue
				}
				out = append(out, strings.Trim(lit.Value, `"`))
			}
		}
		return true
	})
	if len(out) == 0 {
		return nil, fmt.Errorf("no EventType constants found in %s", path)
	}
	return out, nil
}

func eventTypeSlug(et string) string {
	return strings.ReplaceAll(et, ".", "-") + "-event"
}

func eventTypeTitle(et string) string {
	parts := strings.Split(et, ".")
	var b strings.Builder
	for _, p := range parts {
		if p == "" {
			continue
		}
		switch p {
		case "api":
			b.WriteString("API")
		case "totp":
			b.WriteString("TOTP")
		default:
			runes := []rune(p)
			runes[0] = unicode.ToUpper(runes[0])
			for i := 1; i < len(runes); i++ {
				if runes[i-1] == '_' {
					runes[i] = unicode.ToUpper(runes[i])
				}
			}
			s := string(runes)
			s = strings.ReplaceAll(s, "_", "")
			b.WriteString(s)
		}
	}
	b.WriteString("Event")
	return b.String()
}
