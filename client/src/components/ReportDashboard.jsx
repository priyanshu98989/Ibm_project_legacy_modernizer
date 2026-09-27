/**
 * client/src/components/ReportDashboard.jsx
 * The main report view shown once analysis is complete.
 *
 * Sections:
 *   1. Header — health score, summary stats, export buttons
 *   2. Executive summary (from Bob)
 *   3. Dependency graph (React Flow)
 *   4. Risky files list with AI suggestions
 *   5. Suggested refactor order
 */

import { useRef } from 'react';
import { Download, FileText, RotateCcw, List } from 'lucide-react';
import HealthScoreGauge from './HealthScoreGauge';
import DependencyGraph from './DependencyGraph';
import RiskList from './RiskList';
import { markdownExportUrl } from '../api';

/**
 * @param {{ report: object, jobId: string, onReset: () => void }} props
 */
export default function ReportDashboard({ report, jobId, onReset }) {
  const dashboardRef = useRef(null);
  const {
    meta,
    healthScore,
    executiveSummary,
    dependencyGraph,
    risks,
    suggestions,
    refactorOrder,
  } = report;

  const highCount   = risks.filter(r => r.severity === 'high').length;
  const mediumCount = risks.filter(r => r.severity === 'medium').length;
  const lowCount    = risks.filter(r => r.severity === 'low').length;

  // ── PDF export (client-side) ────────────────────────────────────────────────
  const exportPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: html2canvas } = await import('html2canvas');

    const canvas = await html2canvas(dashboardRef.current, {
      backgroundColor: '#030712', // gray-950
      scale: 1.5,
      useCORS: true,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
    const pdfWidth  = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`modernization-report-${jobId.slice(0, 8)}.pdf`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Top nav ── */}
      <header className="sticky top-0 z-20 bg-gray-900/90 backdrop-blur border-b border-gray-800 px-6 py-3
                         flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔬</span>
          <span className="font-semibold text-white">Legacy Code Modernizer</span>
          <span className="text-gray-600 text-sm ml-2">
            · Job <code className="text-gray-400 text-xs">{jobId.slice(0, 8)}</code>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={markdownExportUrl(jobId)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm
                       text-gray-300 transition-colors"
          >
            <FileText size={14} />
            <span>Export MD</span>
          </a>
          <button
            onClick={exportPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm
                       text-gray-300 transition-colors"
          >
            <Download size={14} />
            <span>Export PDF</span>
          </button>
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm
                       text-white transition-colors"
          >
            <RotateCcw size={14} />
            <span>New Analysis</span>
          </button>
        </div>
      </header>

      {/* ── Dashboard content ── */}
      <div ref={dashboardRef} className="max-w-6xl mx-auto px-6 py-8 space-y-10">

        {/* ── Summary row ── */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Health gauge */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Codebase Health
            </h2>
            <HealthScoreGauge score={healthScore} />
          </div>

          {/* Stats */}
          <div className="md:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Analysis Overview
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Files Scanned',   value: meta.fileCount,            color: 'text-white' },
                { label: 'High Risk',       value: highCount,                  color: 'text-red-400' },
                { label: 'Medium Risk',     value: mediumCount,                color: 'text-yellow-400' },
                { label: 'Low Risk',        value: lowCount,                   color: 'text-green-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-800/60 rounded-xl p-4 text-center">
                  <div className={`text-3xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-gray-500 mt-1">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2 flex-wrap">
              {meta.languages.map(lang => (
                <span key={lang} className="bg-gray-800 text-gray-300 rounded px-2 py-0.5 text-xs">
                  {lang}
                </span>
              ))}
              <span className="text-xs text-gray-600 ml-auto self-center">
                Generated {new Date(meta.generatedAt).toLocaleString()}
              </span>
            </div>
          </div>
        </section>

        {/* ── Executive Summary ── */}
        {executiveSummary && (
          <section>
            <SectionHeader icon="📋" title="Executive Summary" />
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <p className="text-gray-300 leading-relaxed text-sm whitespace-pre-wrap">{executiveSummary}</p>
            </div>
          </section>
        )}

        {/* ── Dependency Graph ── */}
        <section>
          <SectionHeader
            icon="🕸️"
            title="Dependency Graph"
            subtitle={`${dependencyGraph.nodes.length} nodes · ${dependencyGraph.edges.length} edges`}
          />
          <DependencyGraph graph={dependencyGraph} />
          <p className="mt-2 text-xs text-gray-600">
            Blue = Java · Amber = COBOL · Green = JavaScript · Edges show import/CALL/COPY relationships (heuristic).
          </p>
        </section>

        {/* ── Risk List ── */}
        <section>
          <SectionHeader
            icon="⚠️"
            title="Risky Files"
            subtitle={`${risks.length} file(s) flagged · sorted by severity`}
          />
          <RiskList risks={risks} suggestions={suggestions} refactorOrder={refactorOrder} />
        </section>

        {/* ── Refactor Order ── */}
        {refactorOrder.length > 0 && (
          <section>
            <SectionHeader
              icon="🗺️"
              title="Suggested Refactor Order"
              subtitle="Safest files to touch first (fewest dependents)"
            />
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <p className="text-xs text-gray-500 mb-4">
                Files with fewer other files depending on them are listed first — changing them carries a lower risk
                of cascading breakage across the rest of the codebase.
              </p>
              <ol className="space-y-2">
                {refactorOrder.map((file, i) => {
                  const risk = risks.find(r => r.file === file);
                  const sev = risk?.severity || 'low';
                  const colors = { high: 'text-red-400', medium: 'text-yellow-400', low: 'text-blue-400' };
                  return (
                    <li key={file} className="flex items-center gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-gray-800 text-gray-400 text-xs flex items-center justify-center flex-shrink-0 font-mono">
                        {i + 1}
                      </span>
                      <code className={`font-mono text-xs flex-1 ${colors[sev]}`}>{file}</code>
                      <span className="text-xs text-gray-600 capitalize">{sev}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

/** Small reusable section header */
function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-xl">{icon}</span>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {subtitle && <span className="text-sm text-gray-500 ml-1">— {subtitle}</span>}
    </div>
  );
}
