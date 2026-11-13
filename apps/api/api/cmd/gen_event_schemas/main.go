// gen_event_schemas generates, from domain.EventType constants, the
// per-event-type OpenAPI schemas, the Event oneOf union with discriminator
// mapping, and the WebhookEvent union: the body of the one webhook
// (endpoints/events/event-webhook.yaml), with a member per event type.
//
// Paths are relative to this generator:
//   - Domain: ../../../internal/domain/event.go
//   - Output: ../../openapi/endpoints/events/
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

	"flow.signup_challenge.issued":   "empty-event-payload.yaml",
	"flow.signup_challenge.consumed": "empty-event-payload.yaml",
	"auth.attempt.created":           "empty-event-payload.yaml",
	"auth.attempt.handed_off":        "empty-event-payload.yaml",
	"auth.check.failed":              "auth-check-payload.yaml",
	"auth.check.succeeded":           "auth-check-payload.yaml",

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

	"application.created": "application-payload.yaml",
	"application.updated": "application-payload.yaml",

	"idp.created": "idp-payload.yaml",
	"idp.updated": "idp-payload.yaml",

	"idp.identity_link.created": "idp-identity-link-created-payload.yaml",

	"deployment.created": "deployment-created-payload.yaml",

	"origin.added":   "origin-payload.yaml",
	"origin.removed": "origin-payload.yaml",

	"variable.set":     "variable-set-payload.yaml",
	"variable.removed": "variable-removed-payload.yaml",

	"preview.removed": "empty-event-payload.yaml",

	"authz.granted": "authz-granted-payload.yaml",
	"authz.revoked": "authz-granted-payload.yaml",

	"invitation.created":   "invitation-created-payload.yaml",
	"invitation.accepted":  "invitation-accepted-payload.yaml",
	"invitation.rejected":  "invitation-rejected-payload.yaml",
	"invitation.cancelled": "invitation-cancelled-payload.yaml",

	"auth.factor.password.set":     "auth-factor-payload.yaml",
	"auth.factor.passkey.enrolled": "auth-factor-payload.yaml",

	"webhook.created":        "webhook-payload.yaml",
	"webhook.updated":        "webhook-payload.yaml",
	"webhook.deleted":        "empty-event-payload.yaml",
	"webhook.secret_rotated": "empty-event-payload.yaml",
	"webhook.disabled":       "webhook-disabled-payload.yaml",
}

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

// webhookDoc is what the webhook's page says of an event type beyond its
// schema: the description of the type's member of the WebhookEvent union.
type webhookDoc struct {
	// description says what happened, for someone receiving the event.
	description string
	status      eventStatus
}

// webhookByEventType documents every domain EventType constant for a webhook's
// receiver.
var webhookByEventType = map[string]webhookDoc{
	"request.api": {description: "An API request in the project completed. One event per request; " +
		"the health, liveness, and readiness probes send none. The requester's IP, user agent and origin " +
		"are in `metadata.client` of the event that `getEvent` (`GET /events/{id}`) returns, and its " +
		"`request_id` joins the other events of the same request to it."},

	"project.created": {description: "A project was created."},
	"project.updated": {description: "A project was updated. `data` holds the fields that changed, " +
		"with their new values."},
	"project.deleted": {description: "A project was deleted."},

	"user.created": {description: "A user was created. `data` lists the attribute keys written, " +
		"with values only for schema fields marked `x-audit`."},
	"user.create.failed": {description: "A user could not be created because a unique attribute was already taken. " +
		"`data.key_name` names the unique constraint that was hit."},
	"user.updated": {description: "A user's attributes were updated. `data` lists the attribute keys " +
		"written, with values only for schema fields marked `x-audit`."},
	"user.deleted": {description: "A user was deleted."},

	"team.created": {description: "A team was created."},
	"team.updated": {description: "A team was updated. `data` holds the fields that changed, " +
		"with their new values."},
	"team.deactivated": {description: "A team was deactivated."},

	"auth.token.issued": {description: "A token was issued."},
	"auth.token.revoked": {description: "A token was revoked. Deleting a session revokes its tokens too. " +
		"Those events have an `entity.id` of `null`; the session's ID is `session_id` of the event that " +
		"`getEvent` (`GET /events/{id}`) returns."},

	"session.established": {description: "A session was established, by a sign-in or by exchanging a session."},
	"session.deleted":     {description: "A session was revoked."},

	"flow.signup_challenge.issued":   {description: "A sign-up proof-of-work challenge was issued."},
	"flow.signup_challenge.consumed": {description: "A signup proof was spent before attempting user creation."},
	"auth.attempt.created": {description: "An authentication attempt started. See " +
		"[Sessions and auth attempts](/docs/concepts/sessions-auth-attempts)."},
	"auth.attempt.handed_off": {description: "An authentication attempt was handed off to a session. " +
		"The attempt is complete, and its verified result moves to the session."},
	"auth.check.failed": {description: "A check in an authentication attempt failed, such as a wrong " +
		"password."},
	"auth.check.succeeded": {description: "A check in an authentication attempt succeeded. The event is also sent " +
		"when a factor is recorded without a challenge, as on sign-up."},

	"auth.sso.authorization.failed": {description: "A sign-in through an identity provider (SSO) failed at the provider. " +
		"It answered with an error, `access_denied` included, or the callback carried no code."},
	"auth.sso.exchange.succeeded": {description: "The code from a sign-in through an identity provider (SSO) was exchanged. " +
		"This is not a sign-in: the identity may still match no user."},
	"auth.sso.exchange.failed": {description: "A sign-in through an identity provider (SSO) failed after its code arrived. " +
		"The token exchange, the ID token or userinfo validation, or the connection's configuration failed."},

	"flowdef.created": {description: "A flow definition was created. A " +
		"[flow definition](/docs/concepts/flows-and-schemas) sets which step of a sign-in renders when, " +
		"and which fields each step collects."},
	"flowdef.updated": {description: "A flow definition was updated.", status: statusRetired},
	"flowdef.deleted": {description: "A flow definition was deleted.", status: statusRetired},

	"schema.created": {description: "A schema was created."},

	"branding.created": {description: "A branding revision was created."},

	"policy.created": {description: "A project published the first revision of its policy for an operation. " +
		"A policy guards an operation, such as setting a password."},
	"policy.updated": {description: "A project published a new revision of its policy for an operation. " +
		"`data` holds the new revision and its settings."},

	"release.created": {description: "A release was created. A [release](/docs/concepts/repo-config) is an immutable " +
		"build of the project's configuration, which a deployment makes live."},
	"release.revoked": {description: "A release was revoked."},

	"application.created": {description: "A registered application was created."},
	"application.updated": {description: "A registered application was revised. The payload holds the new " +
		"revision, the name when it changed, and the clients the revision added."},

	"idp.created": {description: "An identity provider (IdP) connection was created."},
	"idp.updated": {description: "An IdP connection was revised. `data` holds the new " +
		"revision and the fields that changed."},

	"idp.identity_link.created": {description: "A user was created by a sign-in through an identity provider (SSO) " +
		"and linked to the provider account."},

	"deployment.created": {description: "A release was deployed, or a deployment rolled back. One event " +
		"per deployment, however many targets it has. A deployment makes a release live on a set of origins."},

	"origin.added": {description: "An origin was added to a project. `data` holds its `pattern` " +
		"and its `kind`, `primary` or `preview`."},
	"origin.removed": {description: "An origin was removed from a project. `data` holds its `pattern` " +
		"and its `kind`, `primary` or `preview`."},

	"variable.set": {description: "A variable was given a value, new or replacing one. One event per kind " +
		"written. The value never appears."},
	"variable.removed": {description: "A variable's value was removed. One event per kind removed."},

	"preview.removed": {description: "A preview was removed before its expiry."},

	"authz.granted": {description: "A role on a project was granted."},
	"authz.revoked": {description: "A role on a project was revoked."},

	"invitation.created": {description: "An invitation was created, new or as the replacement of another."},
	"invitation.accepted": {description: "An invitation was accepted. The grant events the acceptance writes " +
		"share its `request_id`, which is on the event that `getEvent` (`GET /events/{id}`) returns; there are " +
		"none when the user already holds an identical active grant.",
		status: statusContracted},
	"invitation.rejected": {description: "An invitation was declined.", status: statusContracted},
	"invitation.cancelled": {description: "A pending invitation was cancelled by an administrator, " +
		"or an unaccepted one was deleted by its replacement."},

	"auth.factor.password.set":     {description: "A user's password was set."},
	"auth.factor.passkey.enrolled": {description: "A passkey was enrolled for a user."},

	"webhook.created": {description: "A webhook was created. `data` holds its `url` without the query, " +
		"and never its signing secret."},
	"webhook.updated": {description: "A webhook was updated, which includes enabling and disabling it. " +
		"`data` holds the fields the update named, with their new values."},
	"webhook.deleted": {description: "A webhook was deleted."},
	"webhook.secret_rotated": {description: "A webhook's signing secret was rotated. The previous secret stays " +
		"valid for 24 hours. The event carries neither secret."},
	"webhook.disabled": {description: "The server disabled a webhook and stopped delivering to it. " +
		"Its deliveries failed for 3 days without one success, or its endpoint answered `410`; " +
		"`data`'s `reason` says which. Enabling it with `updateWebhook` (`PATCH /webhooks/{id}`) " +
		"starts delivery again from that moment."},
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
  An event of type %s, with the shared event fields and its own payload.
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

	path := filepath.Join(outDir, webhookEventFile)
	if err := os.WriteFile(path, []byte(webhookEventYAML(eventTypes)), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write %s: %v\n", path, err)
		os.Exit(1)
	}

	fmt.Printf("✅ Generated %d event type schemas and the webhook body in %s\n", len(eventTypes), outDir)
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

func writeEventUnion(outDir string, eventTypes []string) error {
	var buf bytes.Buffer
	buf.WriteString(`# Code generated by gen_event_schemas; DO NOT EDIT.
# Discriminated wide-event union (ADR 048 / ADR 049).
description: |
  An event of any type. Read event_type to tell which type it is; each type
  carries its own typed payload.
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

// webhookEventFile is the generated body of the webhook, beside the
// hand-written webhook-event-base.yaml its members extend.
const webhookEventFile = "webhook-event.yaml"

// webhookEventYAML is the WebhookEvent union: per event type, the envelope
// with `type` fixed to it and `data` its payload. A member's title is what the
// API reference lists in its selector, and its description what it shows once
// the member is selected.
func webhookEventYAML(eventTypes []string) string {
	var buf bytes.Buffer
	buf.WriteString(`# Code generated by gen_event_schemas; DO NOT EDIT.
title: WebhookEvent
description: |
  An event as a project's webhook receives it. Read type to tell which
  event type it is; each type carries its own data.
oneOf:
`)
	for _, et := range eventTypes {
		doc := webhookByEventType[et]
		paragraphs := []string{doc.description}
		switch doc.status {
		case statusRetired:
			paragraphs = append(paragraphs, "Retired: nothing sends this event any more. It stays in the API so "+
				"stored events still decode.")
		case statusContracted:
			paragraphs = append(paragraphs, "Not sent yet: the contract is published ahead of the code that "+
				"sends it.")
		}

		fmt.Fprintf(&buf, "  - title: %s\n    description: |\n", et)
		for i, paragraph := range paragraphs {
			if i > 0 {
				buf.WriteString("\n")
			}
			for _, line := range wrapText(paragraph, 70) {
				fmt.Fprintf(&buf, "      %s\n", line)
			}
		}
		if doc.status == statusRetired {
			buf.WriteString("    deprecated: true\n")
		}
		fmt.Fprintf(&buf, `    allOf:
      - $ref: webhook-event-base.yaml
      - type: object
        required:
          - type
          - data
        properties:
          type:
            type: string
            const: %s
          data:
            $ref: payloads/%s
`, et, payloadByEventType[et])
	}
	buf.WriteString("discriminator:\n  propertyName: type\n")
	return buf.String()
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
