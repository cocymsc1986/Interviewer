import Link from 'next/link';

export default function Home() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-20">
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold text-white mb-4">Interview Prep Library</h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto">
          A curated collection of coding problems with solutions and system design examples with diagrams.
          Everything you need to prepare for technical interviews.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Link href="/coding" className="group block bg-gray-900 border border-gray-800 rounded-2xl p-8 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10">
          <div className="text-4xl mb-4">💻</div>
          <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-blue-400 transition-colors">
            Coding Problems
          </h2>
          <p className="text-gray-400 mb-6">
            30 classic algorithm and data structure problems covering arrays, trees, graphs, dynamic programming, and more — each with a full breakdown and working solution.
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {['Arrays', 'Trees', 'Graphs', 'DP', 'Binary Search', 'Linked Lists'].map(tag => (
              <span key={tag} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">
                {tag}
              </span>
            ))}
          </div>
          <span className="text-blue-400 font-medium group-hover:underline">Browse 30 problems →</span>
        </Link>

        <Link href="/system-design" className="group block bg-gray-900 border border-gray-800 rounded-2xl p-8 hover:border-purple-500 transition-all hover:shadow-lg hover:shadow-purple-500/10">
          <div className="text-4xl mb-4">🏗️</div>
          <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-purple-400 transition-colors">
            System Design
          </h2>
          <p className="text-gray-400 mb-6">
            30 real-world system design examples — from URL shorteners to distributed databases — each with requirements, a full solution breakdown, and an architecture diagram.
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {['Scalability', 'Databases', 'Caching', 'Messaging', 'CDN', 'Distributed'].map(tag => (
              <span key={tag} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">
                {tag}
              </span>
            ))}
          </div>
          <span className="text-purple-400 font-medium group-hover:underline">Browse 30 designs →</span>
        </Link>
      </div>
    </div>
  );
}
