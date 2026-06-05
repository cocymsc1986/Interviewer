'use client';

import { useEffect, useRef } from 'react';

export default function MermaidDiagram({ chart }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

      const id = `mermaid-${Math.random().toString(36).slice(2)}`;
      try {
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = `<pre class="text-red-400 text-xs p-4">${chart}</pre>`;
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [chart]);

  return (
    <div
      ref={containerRef}
      className="mermaid bg-gray-900 rounded-xl p-6 border border-gray-700 overflow-x-auto"
    />
  );
}
