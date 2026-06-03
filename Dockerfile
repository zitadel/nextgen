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
# Root cobra command is already `server` (see main.go); no extra argv.
