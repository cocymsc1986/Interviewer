'use client';

import { useMemo, useState } from 'react';
import { codingProblems } from '@/data/codingProblems';
import ProblemCard from '@/components/ProblemCard';
import FilterBar from '@/components/FilterBar';

const difficulties = ['Easy', 'Medium', 'Hard'];
const categories = [...new Set(codingProblems.map(p => p.category))];

export default function CodingPage() {
  const [activeDifficulty, setActiveDifficulty] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');

  const filtered = useMemo(() => {
    return codingProblems.filter(p => {
      const diffMatch = activeDifficulty === 'All' || p.difficulty === activeDifficulty;
      const catMatch = activeCategory === 'All' || p.category === activeCategory;
      return diffMatch && catMatch;
    });
  }, [activeDifficulty, activeCategory]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Coding Problems</h1>
        <p className="text-gray-400">
          {codingProblems.length} classic algorithm problems with full solutions.
          Showing <span className="text-white font-medium">{filtered.length}</span>.
        </p>
      </div>

      <FilterBar
        difficulties={difficulties}
        categories={categories}
        activeDifficulty={activeDifficulty}
        activeCategory={activeCategory}
        onDifficultyChange={setActiveDifficulty}
        onCategoryChange={setActiveCategory}
        accentClass="border-blue-500 bg-blue-500/10 text-blue-300"
      />

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-center py-16">No problems match the selected filters.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(problem => (
            <ProblemCard key={problem.id} problem={problem} />
          ))}
        </div>
      )}
    </div>
  );
}
