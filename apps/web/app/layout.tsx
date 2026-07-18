import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ProductNav } from '../components/ProductNav';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = {
  title: 'Ajace — Immigration & HR',
  description: 'Immigration case management and HR lifecycle for staffing & consulting firms',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <ProductNav current="hr" />
        {children}
      </body>
    </html>
  );
}
