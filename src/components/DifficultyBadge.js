const colours = {
  Easy: 'bg-green-900 text-green-300 border border-green-700',
  Medium: 'bg-yellow-900 text-yellow-300 border border-yellow-700',
  Hard: 'bg-red-900 text-red-300 border border-red-700',
};

export default function DifficultyBadge({ difficulty }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colours[difficulty] ?? 'bg-gray-800 text-gray-400'}`}>
      {difficulty}
    </span>
  );
}
