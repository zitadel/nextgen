/**
 * Policy tests (#1445): `.zitadel/policies/<operation>.test.json` files hold
 * cases `zitadel policies test` evaluates on the server
 * (`POST /policies/evaluate`). The CLI never evaluates a policy itself; it
 * picks the config to evaluate, sends each case and compares the decision.
 *
 * The config comes from the sibling policy file, or with `--release` from the
 * revision a release pins. Neither present means no policy: the cases are
 * evaluated with `{}`, which is what the server enforces then (only its own
 * guards), so a case that expects a refusal shows what would get through.
 *
 * **Dependency rule.** No upward imports (`commands/`, `release/`).
 */
import { join } from "node:path";

import type { EvaluatePolicy200 } from "@zitadel/api/generated/model";
import { policyTestFileSchema } from "@zitadel/config/schemas";
import type { z } from "zod";

import type { ZitadelClient } from "../api-client";
import { readJsonDirEntries } from "../json-dir";
import {
  isPolicyTestFile,
  POLICIES_DIR,
  POLICY_TEST_SUFFIX,
  policyFileIssues,
  policyFileName,
} from "./index";

/** A policy test file as `policyTestFileSchema` accepts it. */
export type PolicyTestFile = z.infer<typeof policyTestFileSchema>;

/** One case's expected decision. */
export type PolicyTestExpect = PolicyTestFile["cases"][number]["expect"];

/** A test file read from `.zitadel/policies/`, with its file name. */
export type PolicyTestSuite = { file: string; test: PolicyTestFile };

/** The name a test file must have: its operation, beside the operation's policy file. */
export function policyTestFileName(operation: string): string {
  return `${operation}${POLICY_TEST_SUFFIX}`;
}

/**
 * What is wrong with a policy test file, each as a line naming the file, or
 * none: it must parse against the strict `policyTestFileSchema` and be named
 * after its operation, as a policy file is.
 */
export function policyTestFileIssues(data: unknown, file: string): string[] {
  const result = policyTestFileSchema.safeParse(data);
  if (!result.success) {
    return result.error.issues.map(
      (issue) => `${file}: ${issue.path.join(".") || "(root)"} ${issue.message}`,
    );
  }
  const expected = policyTestFileName(result.data.operation);
  const name = file.split("/").at(-1);
  if (name !== expected) {
    return [`${file} tests the ${result.data.operation} policy, so it must be named ${expected}`];
  }
  return [];
}

/**
 * The test files in `.zitadel/policies/`, checked, and the problems found.
 * `operations` narrows them to those operations' files, by name and before
 * anything is parsed, so a broken test file of another operation never
 * blocks the ones asked for. One without a test file is a problem, so a typo
 * in the filter never passes silently.
 */
export async function readPolicyTests(
  cwd: string,
  operations: readonly string[] = [],
): Promise<{ suites: PolicyTestSuite[]; issues: string[] }> {
  const wanted = new Set(operations.map(policyTestFileName));
  const entries = await readJsonDirEntries(join(cwd, POLICIES_DIR), {
    skip: (name) => !isPolicyTestFile(name) || (wanted.size > 0 && !wanted.has(name)),
  });
  const suites: PolicyTestSuite[] = [];
  const issues: string[] = [];
  for (const entry of entries) {
    const file = `${POLICIES_DIR}/${entry.name}`;
    const problems = policyTestFileIssues(entry.body, file);
    if (problems.length > 0) {
      issues.push(...problems);
      continue;
    }
    suites.push({ file, test: policyTestFileSchema.parse(entry.body) });
  }
  for (const operation of operations) {
    const file = policyTestFileName(operation);
    if (!entries.some((entry) => entry.name === file)) {
      issues.push(`${POLICIES_DIR}/${file} does not exist`);
    }
  }
  return { suites, issues };
}

/** Where a tested config came from: a policy file, a release's revision, or nowhere. */
export type PolicySource = { file: string } | { revision_id: string } | null;

/** The policy a suite is evaluated against, by operation. */
export type PolicyUnderTest = { config: Record<string, unknown>; source: PolicySource };

/**
 * The policies in `.zitadel/policies/`, by operation, and the problems found.
 * A policy file that fails its own check is a problem rather than "no
 * policy": testing `{}` in its place would report on a policy nobody wrote.
 * `operations` narrows them to those operations' files, by name and before
 * anything is parsed, as {@link readPolicyTests} does.
 */
export async function policiesFromFiles(
  cwd: string,
  operations: readonly string[] = [],
): Promise<{ policies: Map<string, PolicyUnderTest>; issues: string[] }> {
  const wanted = new Set(operations.map(policyFileName));
  const entries = await readJsonDirEntries(join(cwd, POLICIES_DIR), {
    skip: (name) => isPolicyTestFile(name) || (wanted.size > 0 && !wanted.has(name)),
  });
  const policies = new Map<string, PolicyUnderTest>();
  const issues: string[] = [];
  for (const entry of entries) {
    const file = `${POLICIES_DIR}/${entry.name}`;
    const problems = policyFileIssues(entry.body, file);
    if (problems.length > 0) {
      issues.push(...problems);
      continue;
    }
    const { operation, config } = entry.body as {
      operation: string;
      config: Record<string, unknown>;
    };
    policies.set(operation, { config, source: { file } });
  }
  return { policies, issues };
}

/** A release's policies, and what makes them differ from what its sign-ins use. */
export type ReleasePolicies = {
  policies: Map<string, PolicyUnderTest>;
  revoked: boolean;
  pinsFlow: boolean;
};

/**
 * The policies a release pins, by operation, read as the revisions it pins.
 * Whether it is revoked and whether it pins a flow come along: neither stops
 * the test, but both mean its sign-ins do not use these policies.
 */
export async function policiesFromRelease(
  client: ZitadelClient,
  projectId: string,
  releaseId: string,
): Promise<ReleasePolicies> {
  const release = await client.getReleaseById(releaseId, { project_id: projectId });
  const pinned = release.pointers.filter((pointer) => pointer.kind === "policy");
  const revisions = await Promise.all(
    pinned.map((pointer) =>
      client.getPolicyRevision(pointer.revision_id, { project_id: projectId }),
    ),
  );
  const policies = new Map<string, PolicyUnderTest>(
    pinned.map((pointer, index) => [
      pointer.handle,
      {
        config: revisions[index]?.config as Record<string, unknown>,
        source: { revision_id: pointer.revision_id },
      },
    ]),
  );
  return {
    policies,
    revoked: release.revoked_at !== null,
    // TODO(#2331): drop once runtime reads follow every release's pins; a
    // release then applies what it pins whether or not it pins a flow.
    pinsFlow: release.pointers.some((pointer) => pointer.kind === "flow_definition"),
  };
}

/** One case's outcome: what it expected and what the server decided. */
export type PolicyCaseResult = {
  name: string;
  passed: boolean;
  expected: PolicyTestExpect;
  actual: EvaluatePolicy200;
};

/** One test file's outcome. */
export type PolicySuiteResult = {
  operation: string;
  file: string;
  policy: PolicySource;
  cases: PolicyCaseResult[];
};

/**
 * Whether a decision is what a case expects: `allowed` always, `code` when
 * given, and `violations` when given as exactly that set of rule names, so a
 * rule that fails unexpectedly fails the case too.
 */
export function caseHolds(expected: PolicyTestExpect, actual: EvaluatePolicy200): boolean {
  if (expected.allowed !== actual.allowed) {
    return false;
  }
  if (expected.code !== undefined && expected.code !== actual.code) {
    return false;
  }
  if (expected.violations !== undefined) {
    const got = Object.keys(actual.violations ?? {}).sort();
    const want = [...new Set(expected.violations)].sort();
    return got.length === want.length && got.every((name, index) => name === want[index]);
  }
  return true;
}

/** How many evaluate requests a run keeps in flight at once. */
const EVALUATE_CONCURRENCY = 8;

/** `fn` over `items` with at most `limit` calls in flight, results in item order. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Evaluates every case of every suite against its operation's policy, or `{}`
 * when there is none: one request per case, a few in flight at once, the
 * results in file and case order.
 */
export async function runPolicyTests(
  client: ZitadelClient,
  projectId: string,
  suites: readonly PolicyTestSuite[],
  policies: ReadonlyMap<string, PolicyUnderTest>,
): Promise<PolicySuiteResult[]> {
  const runs = suites.flatMap(({ test }, suite) =>
    test.cases.map((testCase) => ({ suite, operation: test.operation, testCase })),
  );
  const outcomes = await mapBounded(
    runs,
    EVALUATE_CONCURRENCY,
    async ({ suite, operation, testCase }) => {
      const actual = await client.evaluatePolicy(
        {
          operation,
          config: policies.get(operation)?.config ?? {},
          input: testCase.input,
          ...(testCase.facts === undefined ? {} : { facts: testCase.facts }),
        },
        { project_id: projectId },
      );
      const result: PolicyCaseResult = {
        name: testCase.name,
        passed: caseHolds(testCase.expect, actual),
        expected: testCase.expect,
        actual,
      };
      return { suite, result };
    },
  );
  return suites.map(({ file, test }, suite) => ({
    operation: test.operation,
    file,
    policy: policies.get(test.operation)?.source ?? null,
    cases: outcomes.filter((outcome) => outcome.suite === suite).map(({ result }) => result),
  }));
}

/**
 * A decision in words: `allowed`, or refused with its code and its rules,
 * each when known, so a mismatch in either shows on the line.
 */
function describeDecision(decision: {
  allowed: boolean;
  code?: string;
  violations?: readonly string[];
}): string {
  if (decision.allowed) {
    return "allowed";
  }
  const rules = decision.violations?.length ? decision.violations.join(", ") : undefined;
  const reason = [decision.code, rules].filter((part) => part !== undefined).join(": ");
  return reason === "" ? "refused" : `refused (${reason})`;
}

/** Where a suite's policy came from, as its heading names it. */
function describePolicy(policy: PolicySource, release: string | undefined): string {
  if (policy === null) {
    return release === undefined
      ? "no policy file, nothing enforced"
      : `release ${release} pins no policy, nothing enforced`;
  }
  if ("file" in policy) {
    return policy.file;
  }
  return `release ${release}, revision ${policy.revision_id}`;
}

/**
 * The results for a terminal: each test file under a heading naming the
 * policy it ran against, a line per case, and on a failed case what was
 * expected and what the server decided; then the totals.
 */
export function renderPolicyTestResults(
  results: readonly PolicySuiteResult[],
  release?: string,
): string {
  const lines: string[] = [];
  let passed = 0;
  let failed = 0;
  for (const result of results) {
    lines.push(`${result.operation}  (${describePolicy(result.policy, release)})`);
    for (const testCase of result.cases) {
      if (testCase.passed) {
        passed++;
        lines.push(`  ✓ ${testCase.name}`);
        continue;
      }
      failed++;
      const actual = describeDecision({
        allowed: testCase.actual.allowed,
        code: testCase.actual.code,
        violations: Object.keys(testCase.actual.violations ?? {}),
      });
      lines.push(
        `  ✗ ${testCase.name}: expected ${describeDecision(testCase.expected)}, got ${actual}`,
      );
    }
  }
  lines.push("", failed === 0 ? `${passed} passed` : `${passed} passed, ${failed} failed`);
  return lines.join("\n");
}
