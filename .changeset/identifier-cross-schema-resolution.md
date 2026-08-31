---
"@zitadel/server": minor
---

Direct-API identifier proofs now resolve. A bare `login_name` submitted
without an attribute name resolves against the designated identifier of every
user schema in the project (ADR 058 §5): each lookup is scoped to the
designating schemas' own users and to uniquely registered values, the value
must match exactly one user across the derived set, and zero or several
matches reject the proof — never schema or property precedence. Previously
the lookup ran with an empty attribute key and could never match.
