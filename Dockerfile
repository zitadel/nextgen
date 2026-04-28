FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /nextgen .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /nextgen /usr/local/bin/nextgen
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nextgen"]
CMD ["server"]
