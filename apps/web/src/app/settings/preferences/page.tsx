import PreferencesClient from "@/components/settings/PreferencesClient";

export default function PreferencesPage() {
  // initial preferences fetched from Supabase once P0-12 + mandates table is ready
  return <PreferencesClient />;
}
