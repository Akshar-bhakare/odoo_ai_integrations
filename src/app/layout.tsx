import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Sunlectric · ERP Portal',
  description: 'Sunlectric ERP — Orders and Incentives',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${inter.variable} h-full antialiased`}><body className="flex min-h-full flex-col">{children}</body></html>;
}
