import {
  type RuntimeBackend,
  type RuntimeMetadata,
  readRuntimeMetadata,
  writeRuntimeMetadata,
} from "../runtime";
import type { ServerStore } from "./lifecycle";

/** The record type of one backend. */
type RecordOf<B extends RuntimeBackend> = Extract<RuntimeMetadata, { backend: B }>;

function isRecordOf<B extends RuntimeBackend>(
  runtime: RuntimeMetadata,
  backend: B,
): runtime is RecordOf<B> {
  return runtime.backend === backend;
}

/**
 * The directory's `.zitadel/local/runtime.json`, seen as the record of one
 * backend. A record the other backend wrote reads as nothing here: that server
 * is not this launcher's to manage, and `LocalServer` handles a backend switch
 * explicitly instead of by one backend mistaking the other's record for its own.
 */
export class RuntimeFileStore<B extends RuntimeBackend> implements ServerStore<RecordOf<B>> {
  private readonly cwd: string;
  private readonly backend: B;

  constructor(cwd: string, backend: B) {
    this.cwd = cwd;
    this.backend = backend;
  }

  async read(): Promise<RecordOf<B> | undefined> {
    const runtime = await readRuntimeMetadata(this.cwd);
    return runtime && isRecordOf(runtime, this.backend) ? runtime : undefined;
  }

  write(record: RecordOf<B>): Promise<void> {
    return writeRuntimeMetadata(this.cwd, record);
  }
}
