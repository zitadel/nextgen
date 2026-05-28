# syntax=docker/dockerfile:1.7
#
# Consumed by goreleaser's `dockers_v2` builder. Goreleaser pre-builds the
# cross-compiled `nextgen` binary for each platform and places it at
# `$TARGETPLATFORM/nextgen` (e.g. `linux/amd64/nextgen`) in the build context.
FROM gcr.io/distroless/static-debian12:nonroot
ARG TARGETPLATFORM
COPY $TARGETPLATFORM/nextgen /usr/local/bin/nextgen
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nextgen"]
# cmd/server has landed and currently runs as the root command (see main.go),
# so the binary starts the server when given config flags. The default CMD
# stays ["--help"] until the root + `server` subcommand split lands.
CMD ["--help"]
