import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ brandId: string }>;
}

export default async function BrandConsoleRedirect({ params }: Props) {
  const { brandId } = await params;
  redirect(`/brand/${brandId}`);
}
