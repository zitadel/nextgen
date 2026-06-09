# syntax=docker/dockerfile:1.7
#
# Consumed by goreleaser's `dockers_v2` builder. Goreleaser pre-builds the
# cross-compiled `nextgen` binary for each platform and places it at
# `$TARGETPLATFORM/nextgen` (e.g. `linux/amd64/nextgen`) in the build context.
FROM debian:12-slim
ARG TARGETPLATFORM

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libicu-dev libssl-dev \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 65532 nonroot \
  && useradd --system --uid 65532 --gid 65532 --home-dir /nonexistent --shell /usr/sbin/nologin nonroot \
  && mkdir -p /var/lib/zitadel/nextgen-data \
  && chown -R 65532:65532 /var/lib/zitadel

COPY $TARGETPLATFORM/nextgen /usr/local/bin/nextgen
USER 65532:65532
VOLUME ["/var/lib/zitadel/nextgen-data"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nextgen"]
# Root cobra command is already `server` (see main.go); no extra argv.
