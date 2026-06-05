import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata = {
  title: 'Interview Prep',
  description: 'Coding problems and system design examples for interview preparation',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main className="min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
