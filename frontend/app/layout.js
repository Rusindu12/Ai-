import './globals.css';
import PwaRegister from '../components/PwaRegister';

export const metadata = {
  title: 'AI Crypto Trading',
  description: 'AI-powered cryptocurrency trading platform on Binance',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export const viewport = {
  themeColor: '#0b0e14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-surface dark:text-gray-100">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
