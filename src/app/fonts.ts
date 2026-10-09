import localFont from 'next/font/local';

export const geistSans = localFont({
  src: './fonts/geist-sans.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
  weight: '100 900',
});

export const geistMono = localFont({
  src: './fonts/geist-mono.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
  weight: '100 900',
});
