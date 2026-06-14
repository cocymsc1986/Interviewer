import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { systemDesignProblems } from '@/data/systemDesignProblems';
import DifficultyBadge from '@/components/DifficultyBadge';
import TagList from '@/components/TagList';

const MermaidDiagram = dynamic(() => import('@/components/MermaidDiagram'), { ssr: false });

export function generateStaticParams() {
  return systemDesignProblems.map(p => ({ slug: p.slug }));
}

export function generateMetadata({ params }) {
  const problem = systemDesignProblems.find(p => p.slug === params.slug);
  return { title: problem ? `${problem.title} | Interview Prep` : 'Not Found' };
}

export default function SystemDesignDetailPage({ params }) {
  const problem = systemDesignProblems.find(p => p.slug === params.slug);
  if (!problem) notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/system-design" className="text-sm text-gray-500 hover:text-gray-300 transition-colors mb-6 inline-block">
        ← Back to System Design
      </Link>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-xs text-gray-500 font-mono">#{problem.id}</span>
        <DifficultyBadge difficulty={problem.difficulty} />
        <span className="text-xs text-gray-500">{problem.category}</span>
      </div>

      <h1 className="text-3xl font-bold text-white mb-3">{problem.title}</h1>
      <TagList tags={problem.tags} />

      <div className="mt-8 space-y-8">
        {/* Problem Statement */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Problem Statement</h2>
          <p className="text-gray-300 leading-relaxed">{problem.problemStatement}</p>
        </section>

        {/* Requirements */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Requirements</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-green-400 mb-3">Functional</h3>
              <ul className="space-y-2">
                {problem.requirements.functional.map((r, i) => (
                  <li key={i} className="text-gray-400 text-sm flex gap-2">
                    <span className="text-green-600 mt-0.5">✓</span> {r}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-blue-400 mb-3">Non-Functional</h3>
              <ul className="space-y-2">
                {problem.requirements.nonFunctional.map((r, i) => (
                  <li key={i} className="text-gray-400 text-sm flex gap-2">
                    <span className="text-blue-600 mt-0.5">◇</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Capacity Estimates */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Capacity Estimates</h2>
          <pre className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">
            {problem.capacityEstimates}
          </pre>
        </section>

        {/* Architecture Diagram */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Architecture Diagram</h2>
          <MermaidDiagram chart={problem.diagram} />
        </section>

        {/* Solution Breakdown */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Solution Breakdown</h2>
          <div className="space-y-4">
            {problem.solutionBreakdown.map((item, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="font-semibold text-purple-400 mb-2">{item.section}</h3>
                <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">{item.content}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Tradeoffs */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Key Tradeoffs</h2>
          <div className="space-y-3">
            {problem.tradeoffs.map((t, i) => (
              <div key={i} className="bg-gray-900 border border-yellow-900/40 rounded-xl p-5">
                <p className="text-yellow-400 font-semibold text-sm mb-1">{t.decision}</p>
                <p className="text-gray-400 text-sm">{t.rationale}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Key Takeaways */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Key Takeaways</h2>
          <ul className="space-y-2">
            {problem.keyTakeaways.map((t, i) => (
              <li key={i} className="flex gap-3 text-gray-300 text-sm">
                <span className="text-purple-400 font-bold mt-0.5">→</span> {t}
              </li>
            ))}
          </ul>
        </section>

        {/* FAQs */}
        {problem.faqs && problem.faqs.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">FAQs</h2>
            <div className="space-y-3">
              {problem.faqs.map((f, i) => (
                <details key={i} className="group bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <summary className="cursor-pointer list-none p-5 flex items-start gap-3 hover:bg-gray-900/60">
                    <span className="text-cyan-400 font-bold text-sm mt-0.5 transition-transform group-open:rotate-90">›</span>
                    <span className="text-gray-200 text-sm font-semibold flex-1">{f.question}</span>
                  </summary>
                  <div className="px-5 pb-5 pl-12 text-gray-400 text-sm leading-relaxed whitespace-pre-line border-t border-gray-800/60">
                    <div className="pt-4">{f.answer}</div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
