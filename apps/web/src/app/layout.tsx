import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppToaster } from '@/components/app-toaster';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'PulseGrid',
  description: 'Environments, pipelines and infrastructure in one place.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans text-sm">
        <ThemeProvider>
          {children}
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
