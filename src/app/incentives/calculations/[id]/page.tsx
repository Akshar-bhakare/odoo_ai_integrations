import { notFound } from 'next/navigation';
import { CalculationDetail } from '@/components/incentives/calculation-detail';

export default async function CalculationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const calculationId = Number(id);
  if (!Number.isInteger(calculationId) || calculationId < 1) notFound();
  return <CalculationDetail calculationId={calculationId} />;
}
