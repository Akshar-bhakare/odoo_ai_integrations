export function paymentSummary(
  finalIncentive: number,
  payments: Array<{ x_amount: number }>,
): { paidAmount: number; paymentState: 'unpaid' | 'partial' | 'paid' } {
  const paidAmount = payments.reduce((total, payment) => total + Number(payment.x_amount || 0), 0);
  return {
    paidAmount,
    paymentState: paidAmount === 0
      ? 'unpaid'
      : paidAmount >= finalIncentive - 0.005 ? 'paid' : 'partial',
  };
}
