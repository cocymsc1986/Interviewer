'use client';

function PillButton({ label, active, onClick, activeClass }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
        active
          ? activeClass
          : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

export default function FilterBar({
  difficulties,
  categories,
  activeDifficulty,
  activeCategory,
  onDifficultyChange,
  onCategoryChange,
  accentClass = 'border-blue-500 bg-blue-500/10 text-blue-300',
}) {
  return (
    <div className="space-y-3 mb-8">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 uppercase tracking-wider w-20">Difficulty</span>
        {['All', ...difficulties].map(d => (
          <PillButton
            key={d}
            label={d}
            active={activeDifficulty === d}
            onClick={() => onDifficultyChange(d)}
            activeClass={accentClass}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 uppercase tracking-wider w-20">Category</span>
        {['All', ...categories].map(c => (
          <PillButton
            key={c}
            label={c}
            active={activeCategory === c}
            onClick={() => onCategoryChange(c)}
            activeClass={accentClass}
          />
        ))}
      </div>
    </div>
  );
}
