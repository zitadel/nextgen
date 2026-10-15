import { type RuntimeMetadata, readRuntimeMetadata, writeRuntimeMetadata } from "../runtime";
import type { ServerStore } from "./lifecycle";

/**
 * The folder's `.zitadel/local/runtime.json`, seen as the record of one backend.
 * A record the other backend wrote reads as nothing here: that server is not
 * this launcher's to manage.
 */
export class RuntimeFileStore<R extends RuntimeMetadata> implements ServerStore<R> {
  private readonly cwd: string;
  private readonly backend: R["backend"];

  constructor(cwd: string, backend: R["backend"]) {
    this.cwd = cwd;
    this.backend = backend;
  }

  async read(): Promise<R | undefined> {
    const runtime = await readRuntimeMetadata(this.cwd);
    return runtime?.backend === this.backend ? (runtime as R) : undefined;
  }

  write(record: R): Promise<void> {
    return writeRuntimeMetadata(this.cwd, record);
  }
}
