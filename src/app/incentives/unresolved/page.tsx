import { UnresolvedWorkbench } from '@/components/incentives/unresolved-workbench';

export default async function UnresolvedPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month = '' } = await searchParams;
  return <UnresolvedWorkbench initialMonth={month} />;
}
