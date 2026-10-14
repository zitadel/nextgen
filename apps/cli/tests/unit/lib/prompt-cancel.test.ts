import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  password: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

import { isCancel, password, text } from "@clack/prompts";
import { parseClientId } from "@zitadel/config/idp";

import { askParsed } from "../../../src/lib/prompt-cancel";

describe("askParsed", () => {
  beforeEach(() => {
    vi.mocked(text).mockReset();
    vi.mocked(password).mockReset();
    vi.mocked(isCancel).mockReturnValue(false);
  });

  it("returns the parsed answer, not the text", async () => {
    vi.mocked(text).mockResolvedValueOnce("  abc  " as never);

    const answer = await askParsed({
      message: "Client ID",
      parse: parseClientId,
      command: "Enable",
    });

    expect(answer).toBe("abc");
  });

  it("masks the input for a secret", async () => {
    vi.mocked(password).mockResolvedValueOnce("s3cret" as never);

    await askParsed({ message: "Secret", parse: parseClientId, secret: true, command: "Enable" });

    expect(text).not.toHaveBeenCalled();
    expect(password).toHaveBeenCalledOnce();
  });

  it("shows what is wrong with an answer as it is typed", async () => {
    vi.mocked(text).mockResolvedValueOnce("x" as never);

    await askParsed({ message: "Client ID", parse: parseClientId, command: "Enable" });

    const validate = vi.mocked(text).mock.calls[0]?.[0]?.validate as
      | ((value: string) => string | undefined)
      | undefined;
    expect(validate?.("")).toBe("Enter the client id.");
    expect(validate?.("x")).toBeUndefined();
  });

  it("starts from the value it was given", async () => {
    vi.mocked(text).mockResolvedValueOnce("x" as never);

    await askParsed({
      message: "Issuer",
      parse: parseClientId,
      command: "Setup",
      initialValue: "https://a.example",
    });

    expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({ initialValue: "https://a.example" });
  });

  it("reports a cancellation as the command having been cancelled", async () => {
    vi.mocked(isCancel).mockReturnValue(true);
    vi.mocked(text).mockResolvedValueOnce(Symbol("cancel") as never);

    await expect(
      askParsed({ message: "Client ID", parse: parseClientId, command: "Setup" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION", message: "Setup cancelled by user" });
  });
});
