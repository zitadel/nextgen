export interface SupportedPlatform {
  platform: string;
  arch: string;
  packageName: string;
}

export const supportedPlatforms: readonly SupportedPlatform[];

/** The platform package that ships the server binary for a platform. Throws when there is none. */
export function platformPackageName(platform?: string, arch?: string): string;

/** Where the server binary for a platform is. The platform package must be installed; the file need not exist. */
export function serverBinaryPath(platform?: string, arch?: string): string;

/** The server binary for a platform, ready to run: it must exist, and is made executable. */
export function resolveServerBinary(platform?: string, arch?: string): string;

export function ensureExecutable(binaryPath: string, platform?: string): void;
