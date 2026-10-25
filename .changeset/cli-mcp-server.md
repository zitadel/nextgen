---
"@zitadel/cli": minor
---

New `zitadel mcp` serves the Zitadel API to an AI agent as MCP tools over stdio, with the project's server and project secret, as `zitadel api` calls it. Each tool is one API operation, named by its operationId and typed by its schema, and an error the server answers with comes back to the agent as the tool's result. Only the operations that read are offered unless you pass `--allow-writes`; with `--dry-run`, a call that would write answers with the request instead of sending it, and `--tag` keeps the parts of the API you name. Add it to an MCP client as a stdio server, for example `claude mcp add zitadel -- npx @zitadel/cli@latest mcp --cwd <app>`. The command is experimental: its tools and flags may change.
