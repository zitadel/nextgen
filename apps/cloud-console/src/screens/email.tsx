import { Mail } from "lucide-react";
import { useId, useState } from "react";

import type { EmailPreferences } from "@zitadel/cloud-functions/contract";
import type { AddonScreenProps } from "@zitadel/console/addon";
import {
  DETAIL_TITLE,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FormError,
  PAGE_TITLE_ROW,
  Page,
  SettingsCard,
  SettingsColumn,
  SettingsSection,
  Switch,
} from "@zitadel/console/addon/ui";

import { cloudGet, cloudSend } from "../cloud-api";
import { screen } from "./screen";

/**
 * Settings → Email: the person's marketing subscriptions, which HubSpot holds
 * (root ADR 084 §7). The same switch as an email's unsubscribe link: either
 * one changes the subscription in HubSpot, and this screen reads it back.
 * Account, security, billing and support email is not marketing and always
 * goes out.
 */
export const emailScreen = screen({
  path: "/settings/email",
  nav: { label: "Email", view: "settings", order: 4, icon: Mail },
  load: () => cloudGet<EmailPreferences>("/account/preferences"),
  Screen: EmailScreen,
});

function EmailScreen({ data, reload }: AddonScreenProps<EmailPreferences>) {
  const id = useId();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const change = async (productNews: boolean) => {
    setError(undefined);
    setSaving(true);
    try {
      await cloudSend<EmailPreferences>("PUT", "/account/preferences", {
        product_news: productNews,
      } satisfies EmailPreferences);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your choice could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <SettingsColumn>
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Email</h1>
        </div>
        <SettingsSection
          title="What we send you"
          description="Email about your account, its security, billing and support requests always reaches you."
        >
          <SettingsCard>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={id}>Product news</FieldLabel>
                <FieldDescription>New features, guides and events.</FieldDescription>
              </FieldContent>
              <Switch
                id={id}
                checked={data.product_news}
                disabled={saving}
                onCheckedChange={(checked) => void change(checked)}
              />
            </Field>
            <FormError message={error} />
          </SettingsCard>
        </SettingsSection>
      </SettingsColumn>
    </Page>
  );
}
