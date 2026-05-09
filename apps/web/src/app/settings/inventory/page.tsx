import InventoryClient from "@/components/settings/InventoryClient";

export default function InventoryPage() {
  // initial zones fetched from Supabase once C-03 (0002_inventory.sql) is ready
  return <InventoryClient />;
}
