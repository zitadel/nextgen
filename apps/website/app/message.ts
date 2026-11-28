// What Zitadel Next is, word for word from the message house: the summary of
// /llms.txt, the share image (scripts/og.html) and the front page's closing
// band say it as `SENTENCE`, and the first of the questions answers with it
// (`ANSWER`). Say "your agent" or "the agent you already use", never
// "agents" alone: Zitadel ships no agent of its own.
const WHAT =
  "open-source auth platform your agent can run: the agent you already use sets up and changes every part, from the login screens to every policy.";

export const SENTENCE = `Zitadel Next is the ${WHAT}`;

export const ANSWER = `The ${WHAT}`;

// The front page's description for search engines and shares (layout.tsx):
// what it does and for which stacks, in the words people search with.
export const DESCRIPTION =
  "Open-source auth your agent sets up and runs: passkeys, SSO, SCIM, OAuth and agent identity for Next.js, Nuxt, SvelteKit and more. Self-host it or use our cloud.";

// The questions about Zitadel Next as a whole, word for word from the message
// house, which /llms.txt answers. The phase and feature pages keep their own.
export const QUESTIONS: readonly { question: string; answer: string }[] = [
  { question: "What is Zitadel Next?", answer: ANSWER },
  {
    question: "Does Zitadel have its own AI agent?",
    answer:
      "No. It opens every part of auth to the agent you already use, and that agent acts with your permissions. Every change it makes names it.",
  },
  {
    question: "Can a coding agent set up sign-in with it?",
    answer:
      "Yes. Your agent adds sign-in to your app and changes every setting, and you review each change.",
  },
  {
    question: "How do the agents in my product get identity?",
    answer:
      "Each signs in as itself and acts for a user only with that user's consent. Every action names both.",
  },
  {
    question: "Is it open source?",
    answer:
      "Yes. The server is AGPL-3.0, and the SDKs and client libraries are MIT. It runs in Zitadel Cloud or on your servers.",
  },
  {
    question: "How is it different from Auth0?",
    answer:
      "It is open source and self-hostable, multi-tenant, and the agent you already use can run every part of it.",
  },
];
