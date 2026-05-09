import PreferencesClient, { type Preferences } from "@/components/settings/PreferencesClient";
import { getDemoCreatorId, getStreamerPrefs } from "@/lib/db";

export default async function PreferencesPage() {
  let initial: Partial<Preferences> | undefined;
  try {
    const creatorId = await getDemoCreatorId();
    const prefs = await getStreamerPrefs(creatorId);
    initial = {
      approvedBrands: prefs.approved_brand_slugs as Preferences["approvedBrands"],
      safetyKeywords: prefs.blocked_keywords,
    };
  } catch {
    // DB unavailable — PreferencesClient falls back to its own defaults
  }
  return <PreferencesClient initial={initial} />;
}
