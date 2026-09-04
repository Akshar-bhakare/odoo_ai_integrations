import { IncentiveSessionProvider } from '@/components/incentives/session-context';
import { IncentiveShell } from '@/components/incentives/shell';

export default function PnlLayout({ children }: { children: React.ReactNode }) {
  return (
    <IncentiveSessionProvider>
      <IncentiveShell>{children}</IncentiveShell>
    </IncentiveSessionProvider>
  );
}
