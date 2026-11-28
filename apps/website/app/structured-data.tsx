import cli from "../../cli/package.json";
import server from "../../server/package.json";
import { links, origin } from "./links";
import { COMPANY, PRODUCT, SENTENCE } from "./message";

// The front page's structured data (schema.org JSON-LD) for search engines
// and AI answers: which product this is and who makes it, built from the
// site's data: the names and the sentence (message.ts), the hosts and the
// repository (links.ts), the server's license and the CLI's version (their
// package.json, which turbo.json lists as the build's inputs). No offers and
// no ratings: there are none, and a price of 0 would misstate the cloud's
// plans.

// The GitHub organization the repository belongs to.
const githubOrganization = links.github.split("/").slice(0, 4).join("/");

const organization = `${links.zitadel}/#organization`;

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": organization,
      name: COMPANY,
      url: links.zitadel,
      sameAs: [githubOrganization, links.zitadel],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${origin}/#software`,
      name: PRODUCT,
      url: `${origin}/`,
      description: SENTENCE,
      applicationCategory: "DeveloperApplication",
      license: `https://spdx.org/licenses/${server.license}.html`,
      isAccessibleForFree: true,
      softwareVersion: cli.version,
      sameAs: links.github,
      publisher: { "@id": organization },
    },
  ],
};

/**
 * The structured data as a block of JSON, which runs nothing; csp-adapter.mjs
 * lists its hash with the page's inline scripts all the same. `<` is
 * escaped, so no value can close it.
 */
export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, "\\u003c") }}
    />
  );
}
