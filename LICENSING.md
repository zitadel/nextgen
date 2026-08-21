# Licensing Policy

This repository uses a split licensing model. The Zitadel product, including the
server and embedded console, is licensed under the GNU Affero General Public
License v3.0 only (AGPL-3.0-only). Client libraries, integration examples, API
contracts, public documentation, and other surfaces meant to be consumed by
downstream applications are licensed under the MIT License.

We use SPDX license identifiers for standard license naming.

## AGPL-3.0-only default

Unless a path-specific MIT override below applies, the contents of this
repository are licensed under AGPL-3.0-only. The full license text is in
[LICENSE](LICENSE).

This default includes, without limitation:

```text
/
cmd/
internal/
apps/console/
apps/login-ui/
apps/server/
apps/server-*/
```

The private root workspace package (`package.json`) follows this default
because it describes the source tree as a whole, not a published client package.

The Docker images published from this repository, including
`ghcr.io/zitadel/nextgen`, are AGPL-3.0-only because they contain the server and
embedded console. The OCI label `org.opencontainers.image.licenses` must reflect
that.

Zitadel is open-source software intended for community use. Determining your
application's compliance with AGPL-3.0-only is your responsibility. We recommend
consulting legal counsel or licensing specialists if you are unsure how the
license applies to your usage. If your application triggers AGPL-3.0-only
obligations and you wish to avoid them, please
[contact us](https://zitadel.com/contact) to discuss commercial licensing
options.

## MIT exceptions

The following files and directories, including their subdirectories, are
licensed under the MIT License:

```text
README.md
CONTRIBUTING.md
AGENTS.md
LICENSING.md
VISION.md
api/
docs/
apps/cli/
apps/docs/
apps/demo-next/
apps/demo-nuxt/
packages/api/
packages/components/
packages/config/
packages/design-tokens/
packages/testing/
packages/sdk-core/
packages/sdk-next/
packages/sdk-*/
```

These exceptions cover code and contracts that are intended to be imported,
generated from, embedded into, or otherwise used by downstream applications
without imposing AGPL-3.0-only obligations on those applications.

For `api/`, OpenAPI `info.license` metadata describes the exposed API
contract/specification license. It does not describe or override the
AGPL-3.0-only license of the Zitadel server implementation.

Each published MIT-licensed npm package must:

- declare `"license": "MIT"` in its `package.json`,
- include a `LICENSE` file at the package root containing the MIT license text,
- carry an SPDX header in source files where reasonable.

Private demo, design-system, and integration workspaces that are listed above
are covered by the path exception while they remain private. Add package-level
MIT `LICENSE` files before publishing any of them as npm packages.

For non-package MIT paths such as `api/` and `docs/`, SPDX headers, generated
metadata, or local README notes are sufficient when the format supports them.

## External contributions

Contributions from Zitadel employees are governed by their employment or
contractual IP terms.

All contributions from people who are not contributing as Zitadel employees are
accepted under the MIT License unless Zitadel explicitly agrees otherwise in
writing before accepting the contribution. By submitting a pull request, patch,
or other contribution, you represent that you have the right to license the
contribution under MIT and you grant Zitadel the right to use, modify,
sublicense, and distribute that contribution under the MIT License.

This inbound MIT grant lets Zitadel include external contributions in
AGPL-3.0-only product code or MIT-licensed exception paths without a separate
Contributor License Agreement (CLA). It does not change the outbound license of
repository files: AGPL-3.0-only remains the default for product code, and the
paths listed under "MIT exceptions" remain MIT-licensed.
