import './globals.css';

export const metadata = {
  title: 'AI Crypto Trading',
  description: 'AI-powered cryptocurrency trading platform on Binance',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-surface dark:text-gray-100">
        {children}
      </body>
    </html>
  );
}
