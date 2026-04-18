# nextgen
Next iteration of the Zitadel identity platform

## Development container

This repository includes a devcontainer setup in `.devcontainer`.
It uses:

- Go 1.26
- Node.js latest LTS (via devcontainer feature)
- PostgreSQL (`postgres:latest`) as a companion service

You can override the PostgreSQL password by setting `POSTGRES_PASSWORD` in your local environment before starting the devcontainer.
