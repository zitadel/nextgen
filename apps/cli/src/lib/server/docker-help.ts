import { dockerRuntimeGuidance, dockerUnavailableMessage } from "./local/docker-guidance";

export type { DockerRuntimeGuidance } from "./local/docker-guidance";

/** What to tell a developer when Docker, which the managed local runtime needs, does not answer. */
export class DockerGuidance {
  /** The message for a Docker that cannot be reached. */
  static readonly unavailable = dockerUnavailableMessage;

  /** What to do about it, and the run to repeat afterwards. */
  static readonly forRetry = dockerRuntimeGuidance;
}
