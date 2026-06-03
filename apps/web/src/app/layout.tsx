import type { Metadata } from 'next';
import '../index.css';

export const metadata: Metadata = {
  title: 'Warhammer Practice Table',
  description: 'Practice-table assistant for Warhammer games.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
