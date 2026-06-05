import Link from 'next/link';
import DifficultyBadge from './DifficultyBadge';
import TagList from './TagList';

export default function SystemDesignCard({ problem }) {
  return (
    <Link
      href={`/system-design/${problem.slug}`}
      className="group block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-purple-600 transition-all hover:shadow-md hover:shadow-purple-500/10"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs text-gray-500 font-mono">#{problem.id}</span>
        <DifficultyBadge difficulty={problem.difficulty} />
      </div>
      <h3 className="text-base font-semibold text-white group-hover:text-purple-400 transition-colors mb-1">
        {problem.title}
      </h3>
      <p className="text-xs text-gray-500 mb-3">{problem.category}</p>
      <TagList tags={problem.tags} />
    </Link>
  );
}
