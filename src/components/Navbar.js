import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-white hover:text-blue-400 transition-colors">
            Interview Prep
          </Link>
          <div className="flex gap-6">
            <Link href="/coding" className="text-gray-300 hover:text-white transition-colors font-medium">
              Coding Problems
            </Link>
            <Link href="/system-design" className="text-gray-300 hover:text-white transition-colors font-medium">
              System Design
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
