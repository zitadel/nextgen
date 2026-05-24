import { vi } from "vitest";

export function buildFetchMock(
	responseInit: { status: number; body?: string; headers?: Record<string, string> } = {
		status: 200,
	},
): {
	fetchImpl: typeof fetch;
	calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
	const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
	const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return new Response(responseInit.body ?? "", {
			status: responseInit.status,
			headers: responseInit.headers ?? { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}
