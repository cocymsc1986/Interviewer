'use client';

import { useMemo, useState } from 'react';
import { systemDesignProblems } from '@/data/systemDesignProblems';
import SystemDesignCard from '@/components/SystemDesignCard';
import FilterBar from '@/components/FilterBar';

const difficulties = ['Easy', 'Medium', 'Hard'];
const categories = [...new Set(systemDesignProblems.map(p => p.category))];

export default function SystemDesignPage() {
  const [activeDifficulty, setActiveDifficulty] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');

  const filtered = useMemo(() => {
    return systemDesignProblems.filter(p => {
      const diffMatch = activeDifficulty === 'All' || p.difficulty === activeDifficulty;
      const catMatch = activeCategory === 'All' || p.category === activeCategory;
      return diffMatch && catMatch;
    });
  }, [activeDifficulty, activeCategory]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">System Design</h1>
        <p className="text-gray-400">
          {systemDesignProblems.length} real-world system design examples with diagrams.
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
        accentClass="border-purple-500 bg-purple-500/10 text-purple-300"
      />

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-center py-16">No designs match the selected filters.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(problem => (
            <SystemDesignCard key={problem.id} problem={problem} />
          ))}
        </div>
      )}
    </div>
  );
}
