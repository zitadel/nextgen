// Showing a block for one deployment only. The Cloud / Self-hosted switch is
// two radios inside the page's `group/deploy`, so the choice needs no script
// and the page stays prerendered. Nothing is imported here, so the calculator
// can use these classes in the browser.

/** The id of the switch's Self-hosted radio, which the classes below select on. */
export const SELF_HOSTED_ID = "deploy-self-hosted";

export const CLOUD_ONLY = "group-has-[#deploy-self-hosted:checked]/deploy:hidden";
export const SELF_HOSTED_ONLY = "hidden group-has-[#deploy-self-hosted:checked]/deploy:block";

/** A flex row's display: in both deployments, or in one only. */
export function flexFor(only?: "cloud" | "self_hosted"): string {
  if (only === "self_hosted") return "hidden group-has-[#deploy-self-hosted:checked]/deploy:flex";
  return only === "cloud" ? `flex ${CLOUD_ONLY}` : "flex";
}
