import { IncentiveSessionProvider } from '@/components/incentives/session-context';

export default function StockLayout({ children }: { children: React.ReactNode }) {
  return <IncentiveSessionProvider>{children}</IncentiveSessionProvider>;
}
