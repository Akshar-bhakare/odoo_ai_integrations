/// <reference lib="webworker" />

import type { CalculationSummaryRecord } from '@/lib/incentives/ui/types';
import { calculationDashboardRow } from '@/lib/incentives/ui/view-model';

self.onmessage = (event: MessageEvent<CalculationSummaryRecord[]>) => {
  self.postMessage(event.data.map(calculationDashboardRow));
};

export {};
