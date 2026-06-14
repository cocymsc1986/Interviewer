'use client';

import { useEffect, useRef } from 'react';

export default function MermaidDiagram({ chart }) {
  const containerRef = useRef(null);
  const panzoomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: false },
      });

      const id = `mermaid-${Math.random().toString(36).slice(2)}`;
      try {
        const { svg } = await mermaid.render(id, chart);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        const svgEl = containerRef.current.querySelector('svg');
        if (!svgEl) return;

        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.style.width = '100%';
        svgEl.style.height = '100%';
        svgEl.style.maxWidth = 'none';

        const { default: svgPanZoom } = await import('svg-pan-zoom');
        if (cancelled) return;
        panzoomRef.current?.destroy?.();
        panzoomRef.current = svgPanZoom(svgEl, {
          zoomEnabled: true,
          controlIconsEnabled: false,
          fit: true,
          center: true,
          minZoom: 0.2,
          maxZoom: 20,
          zoomScaleSensitivity: 0.35,
        });
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = `<pre class="text-red-400 text-xs p-4">${chart}</pre>`;
        }
      }
    }

    render();
    return () => {
      cancelled = true;
      try { panzoomRef.current?.destroy?.(); } catch {}
      panzoomRef.current = null;
    };
  }, [chart]);

  const btn = 'w-8 h-8 flex items-center justify-center rounded-md bg-gray-800/80 hover:bg-gray-700 text-gray-200 border border-gray-700 backdrop-blur-sm transition-colors text-lg leading-none select-none';

  return (
    <div className="relative bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div
        ref={containerRef}
        className="mermaid"
        style={{ height: '600px', cursor: 'grab' }}
      />
      <div className="absolute top-3 right-3 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => panzoomRef.current?.zoomIn()}
          className={btn}
        >+</button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => panzoomRef.current?.zoomOut()}
          className={btn}
        >−</button>
        <button
          type="button"
          aria-label="Reset view"
          onClick={() => {
            const pz = panzoomRef.current;
            if (!pz) return;
            pz.resetZoom();
            pz.center();
            pz.fit();
          }}
          className={`${btn} text-xs`}
        >⤢</button>
      </div>
      <div className="absolute bottom-3 left-3 text-xs text-gray-500 select-none pointer-events-none">
        scroll to zoom · drag to pan
      </div>
    </div>
  );
}
