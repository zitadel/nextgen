# syntax=docker/dockerfile:1.7
#
# Consumed by Moon release tasks. They pre-build the cross-compiled `nextgen`
# binary for each platform and place it at `$TARGETPLATFORM/nextgen`
# (for example, `linux/amd64/nextgen`) in the Docker build context.
FROM debian:12-slim
ARG TARGETPLATFORM

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libicu72 libssl3 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 65532 nonroot \
  && useradd --system --uid 65532 --gid 65532 --home-dir /nonexistent --shell /usr/sbin/nologin nonroot \
  && mkdir -p /var/lib/zitadel/nextgen-data \
  && chown -R 65532:65532 /var/lib/zitadel

COPY $TARGETPLATFORM/nextgen /usr/local/bin/nextgen
# Without this the data dir defaults next to the entrypoint, in root-owned
# /usr/local/bin, which the non-root USER below cannot create. Point it at the
# volume prepared above so `docker run <image>` works with no extra flags.
ENV NEXTGEN_SERVER_DATA_DIR=/var/lib/zitadel/nextgen-data
USER 65532:65532
VOLUME ["/var/lib/zitadel/nextgen-data"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nextgen"]
# Default argv applies schema migrations then serves. Override with
# `migrate` (apply and exit) or drop `--migrate` once a migrate job has run.
CMD ["--migrate"]
