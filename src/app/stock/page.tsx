import type { Metadata } from 'next';
import { VoiceStock } from '@/components/stock/voice-stock';

export const metadata: Metadata = {
  title: 'Inventory Copilot | Sunlectric',
  description: 'Ask an AI assistant for live Odoo inventory by voice or text.',
};

export default function StockPage() {
  return <VoiceStock />;
}
