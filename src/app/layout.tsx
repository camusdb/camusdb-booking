import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { Header } from '@/components/Header';
import './globals.css';

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'CamusBooking',
  description: 'A sample Next.js flight desk on CamusDB — serializable seats, idempotent PNRs, and time travel.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <div className="shell">
          <Header />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
