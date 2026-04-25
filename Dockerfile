# syntax=docker/dockerfile:1.7
#
# This Dockerfile is consumed by goreleaser, which pre-builds the cross-compiled
# `nextgen` binary and places it in the build context. The image is intentionally
# minimal: a distroless static base with a non-root user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY nextgen /usr/local/bin/nextgen
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nextgen"]
# Placeholder default until cmd/server lands (see PR #17).
# Switches to ["server"] once the subcommand exists.
CMD ["--help"]
