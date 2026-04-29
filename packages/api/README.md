# @zitadel-nextgen/api

Generated TypeScript API client for the OpenAPI definitions in `api/openapi/`.

## Generate

```sh
corepack pnpm nx run @zitadel-nextgen/api:generate
```

## Build

```sh
corepack pnpm nx build @zitadel-nextgen/api
```

`build`, `typecheck`, `test`, and `lint` all depend on `generate`.

## Runtime base URL

```ts
import { setApiBaseUrl } from "@zitadel-nextgen/api";

setApiBaseUrl("https://acc.nextgen.zitadel.com");
```
