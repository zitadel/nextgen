import { Collection } from "@/lib/zitadel/resources/collection";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { Policy, PolicyTest } from "@/lib/zitadel/resources/policies/policy";

/**
 * The operation policies under `.zitadel/policies/`, and the test files
 * beside them.
 */
export class Policies extends Collection<Policy> {
  /**
   * The policies' test files, which `zitadel policies test` runs and a
   * release never carries.
   */
  readonly tests: readonly PolicyTest[];

  /**
   * Hold the policies of a configuration and their test files.
   *
   * @param config - The configuration the collection is part of.
   * @param documents - The policies.
   * @param tests - The policies' test files.
   */
  constructor(config: ZitadelConfig, documents: readonly Policy[], tests: readonly PolicyTest[]) {
    super(config, documents);
    this.tests = tests;
  }
}
