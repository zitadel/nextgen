# How the build runs

`nuxtModule()` returns seven Vite plugins. They apply to `vite build` only.

1. **`nuxt-module:warnings`** records every warning Vite logs and fails the build on it, once the
   config has resolved and again once the bundle is written. It also carries the build's outcome,
   which the steps below read so that a failed build leaves nothing behind.
2. **`nuxt-module:config`** (`enforce: "pre"`) resolves the options against the project's Vite config
   (`resolveOptions`, in `src/options.ts`), runs `nuxi prepare` when asked, checks the tsconfig chain,
   and returns the Vite config (`buildConfig`, in `src/plugin.ts`): an SSR build with the module and
   the extra entries as library entries, ES output named `<name><extension>`, shared chunks in
   `shared/`, and the externals.
3. **`nuxt-module:runtime-externals`** turns an import of a runtime file into an external with a
   stand-in specifier, and renders it relative to the importing chunk once the chunk is written
   (Rolldown writes a relative external relative to the entries' common directory, not to the chunk).
4. **`nuxt-module:implicit-dependencies`** warns for each package inlined into the bundle that the
   module does not depend on.
5. **`nuxt-module:no-build-paths`** fails the build when an emitted file names the build machine's
   path.
6. **`nuxt-module:runtime`** writes `runtime/` after the bundle (`src/runtime.ts`): each file is
   transpiled, rewritten (`src/specifiers.ts`) or copied, then its declarations are emitted
   (`src/runtime-declarations.ts`).
7. **`nuxt-module:outputs`** writes the bundled declarations (`src/declarations/bundle.ts`, with
   `rolldown-plugin-dts`), `module.json` (`src/module-json.ts`) and `types.d.mts`
   (`src/types-entry.ts`).

Steps 6 and 7 run in `closeBundle`, in plugin order, and only when the build succeeded.

## Where the code is

| Path                          | Concern                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/defaults.ts`             | Every default, as a named constant                                                              |
| `src/options.ts`              | The options, their validation and defaults                                                      |
| `src/plugin.ts`               | `nuxtModule()` and the Vite config it adds                                                      |
| `src/externals.ts`            | What stays external, and `NUXT_EXTERNALS`                                                       |
| `src/warnings.ts`             | The warnings-as-errors policy and the steps that run after the bundle                           |
| `src/nuxt-tsconfig.ts`        | The tsconfig chain, and the message when `.nuxt/tsconfig.json` is missing                       |
| `src/prepare.ts`              | `nuxi prepare` in a child process                                                               |
| `src/runtime*.ts`, `src/specifiers.ts`, `src/vue-sfc.ts`, `src/sass.ts` | The per-file runtime                                                  |
| `src/declarations/`           | Bundling the declarations, and checking the sources and the written declarations                |
| `src/outputs.ts`              | The steps after the bundle                                                                      |
| `src/resolve.ts`              | Loading tools (TypeScript, Sass, `vue-tsc`) from the module being built                         |

## Tests

`pnpm run test` runs the unit tests (about half of them build a small package on disk with Vite).
`pnpm run test:contract` runs the contract spec, which needs the built plugin (`pnpm run build`).
