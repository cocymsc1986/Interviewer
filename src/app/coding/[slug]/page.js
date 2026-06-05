import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { codingProblems } from '@/data/codingProblems';
import DifficultyBadge from '@/components/DifficultyBadge';
import TagList from '@/components/TagList';
import ApproachSection from '@/components/ApproachSection';

const CodeBlock = dynamic(() => import('@/components/CodeBlock'), { ssr: false });

export function generateStaticParams() {
  return codingProblems.map(p => ({ slug: p.slug }));
}

export function generateMetadata({ params }) {
  const problem = codingProblems.find(p => p.slug === params.slug);
  return { title: problem ? `${problem.title} | Interview Prep` : 'Not Found' };
}

export default function CodingDetailPage({ params }) {
  const problem = codingProblems.find(p => p.slug === params.slug);
  if (!problem) notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/coding" className="text-sm text-gray-500 hover:text-gray-300 transition-colors mb-6 inline-block">
        ← Back to Coding Problems
      </Link>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-xs text-gray-500 font-mono">#{problem.id}</span>
        <DifficultyBadge difficulty={problem.difficulty} />
        <span className="text-xs text-gray-500">{problem.category}</span>
      </div>

      <h1 className="text-3xl font-bold text-white mb-3">{problem.title}</h1>
      <TagList tags={problem.tags} />

      <div className="mt-8 space-y-8">
        {/* Description */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Problem</h2>
          <p className="text-gray-300 leading-relaxed">{problem.description}</p>
        </section>

        {/* Examples */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Examples</h2>
          <div className="space-y-3">
            {problem.examples.map((ex, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm">
                <p className="text-gray-400"><span className="text-gray-500">Input: </span>{ex.input}</p>
                <p className="text-gray-400"><span className="text-gray-500">Output: </span>{ex.output}</p>
                {ex.explanation && (
                  <p className="text-gray-500 text-xs mt-1">// {ex.explanation}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Constraints */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Constraints</h2>
          <ul className="space-y-1">
            {problem.constraints.map((c, i) => (
              <li key={i} className="text-gray-400 text-sm flex gap-2">
                <span className="text-gray-600">•</span> {c}
              </li>
            ))}
          </ul>
        </section>

        {/* Approach */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Approach</h2>
          <ApproachSection approach={problem.approach} />
        </section>

        {/* Complexity */}
        <div className="flex gap-6">
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">Time Complexity</p>
            <p className="font-mono text-green-400 font-semibold">{problem.timeComplexity}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">Space Complexity</p>
            <p className="font-mono text-blue-400 font-semibold">{problem.spaceComplexity}</p>
          </div>
        </div>

        {/* Solution */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Solution</h2>
          <CodeBlock code={problem.solution.code} language={problem.solution.language} />
        </section>
      </div>
    </div>
  );
}
