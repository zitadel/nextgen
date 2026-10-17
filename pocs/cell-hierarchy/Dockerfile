FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/cell ./cmd/cell && CGO_ENABLED=0 go build -o /out/ui ./cmd/ui

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl jq && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/cell /usr/local/bin/cell
COPY --from=build /out/ui /usr/local/bin/ui
COPY scripts/bootstrap-joins.sh /usr/local/bin/bootstrap-joins.sh
RUN chmod +x /usr/local/bin/bootstrap-joins.sh
WORKDIR /data
EXPOSE 8100 3000
