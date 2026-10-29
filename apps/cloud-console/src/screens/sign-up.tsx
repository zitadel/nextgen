import type { AddonSignedOutScreen } from "@zitadel/console/addon";
import { SignInScreen } from "@zitadel/console/addon/ui";

/**
 * `/signup`: the sign-in widget on its `register` purpose, so a link can start
 * at creating a cloud account (root ADR 083 §3). It offers what the platform
 * project's flow offers. Nothing links here: public sign-up waits for email
 * verification, and until then this is the address to show the flow. The
 * login page's "Sign up" link is the flow's own, not this screen's.
 */
export const signUpScreen: AddonSignedOutScreen = {
  path: "/signup",
  Screen: ({ next }) => (
    <SignInScreen
      purpose="register"
      title="Create your Zitadel account"
      description="An account for managing Zitadel projects. Your app's users sign up through your app, not here."
      next={next}
    />
  ),
};
