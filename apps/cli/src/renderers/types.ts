export type RendererId = "react" | "web-component";

export const RENDERER_IDS: RendererId[] = ["react", "web-component"];

export type RendererStatus = "available" | "not-implemented";

export type RendererAuthPage = {
  mode: "login" | "register";
  contents: string;
};

export type RendererProfilePage = {
  contents: string;
};

export type RendererCustomElementsDts = {
  contents: string;
};

export type RendererTemplates = {
  provider?: { filename: string; contents: string };
  authPage(mode: "login" | "register"): RendererAuthPage;
  profilePage?(): RendererProfilePage;
  customElementsDts?(): RendererCustomElementsDts;
};

export type RendererSpec = {
  id: RendererId;
  displayName: string;
  status: RendererStatus;
  frameworks: string[];
  dependency: { name: string; version: string };
  templates: RendererTemplates;
};

export function isRendererId(value: unknown): value is RendererId {
  return typeof value === "string" && (RENDERER_IDS as string[]).includes(value);
}
