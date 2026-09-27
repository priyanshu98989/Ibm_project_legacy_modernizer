/**
 * client/src/components/RiskList.jsx
 * Prioritised list of risky files with expandable issue details
 * and inline AI modernization suggestions.
 *
 * Features:
 *  - Expand All / Collapse All
 *  - Color-coded issue count badge
 *  - "Copy" button on AI suggestion diff blocks
 */

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, AlertCircle, Info, Lightbulb, ChevronsDownUp, ChevronsUpDown, Copy, Check } from 'lucide-react';

const SEVERITY_CONFIG = {
  high:   { Icon: AlertTriangle, color: 'text-red-400',    bg: 'bg-red-950/40',    border: 'border-red-800',    badge: 'bg-red-900 text-red-300',      countBg: 'bg-red-800 text-red-200'    },
  medium: { Icon: AlertCircle,   color: 'text-yellow-400', bg: 'bg-yellow-950/40', border: 'border-yellow-800', badge: 'bg-yellow-900 text-yellow-300', countBg: 'bg-yellow-800 text-yellow-200' },
  low:    { Icon: Info,          color: 'text-green-400',  bg: 'bg-green-950/20',  border: 'border-green-900',  badge: 'bg-green-950 text-green-300',   countBg: 'bg-green-900 text-green-200'  },
};

/** Small "Copy" button that shows a checkmark for 2s after copying */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600
                 text-gray-300 transition-colors"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

/**
 * @param {{
 *   risks: object[],
 *   suggestions: object[],
 *   refactorOrder: string[]
 * }} props
 */
export default function RiskList({ risks, suggestions, refactorOrder }) {
  const [expanded, setExpanded] = useState(new Set());

  const toggle = (file) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(file) ? next.delete(file) : next.add(file);
      return next;
    });

  const expandAll  = useCallback(() => setExpanded(new Set(risks.map(r => r.file))), [risks]);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);
  const allExpanded = expanded.size === risks.length && risks.length > 0;

  // Map file → suggestion for O(1) lookup
  const suggestionMap = Object.fromEntries(suggestions.map(s => [s.file, s]));
  // Map file → refactor position
  const refactorPos = Object.fromEntries(refactorOrder.map((f, i) => [f, i + 1]));

  if (risks.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No risks flagged — codebase looks clean! 🎉
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">{risks.length} file(s) — click to expand</span>
        <button
          onClick={allExpanded ? collapseAll : expandAll}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1
                     bg-gray-800 hover:bg-gray-700 rounded transition-colors"
        >
          {allExpanded
            ? <><ChevronsDownUp size={13} /> Collapse All</>
            : <><ChevronsUpDown size={13} /> Expand All</>
          }
        </button>
      </div>

      <div className="space-y-3">
        {risks.map((risk) => {
          const cfg = SEVERITY_CONFIG[risk.severity] || SEVERITY_CONFIG.low;
          const isOpen = expanded.has(risk.file);
          const suggestion = suggestionMap[risk.file];
          const order = refactorPos[risk.file];

          return (
            <div
              key={risk.file}
              className={`rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden`}
            >
              {/* Header row */}
              <button
                onClick={() => toggle(risk.file)}
                className="w-full flex items-start gap-3 p-4 text-left hover:bg-white/5 transition-colors"
              >
                <cfg.Icon size={18} className={`${cfg.color} flex-shrink-0 mt-0.5`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm text-gray-200 font-mono break-all">{risk.file}</code>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cfg.badge}`}>
                      {risk.severity.toUpperCase()}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                      {risk.language}
                    </span>
                    {order && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                        Refactor #{order}
                      </span>
                    )}
                    {/* Issue count badge */}
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ml-auto ${cfg.countBg}`}>
                      {risk.issues.length} issue{risk.issues.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {isOpen
                  ? <ChevronDown size={16} className="text-gray-500 flex-shrink-0 mt-1" />
                  : <ChevronRight size={16} className="text-gray-500 flex-shrink-0 mt-1" />
                }
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 border-t border-gray-800/60 pt-3 space-y-4">
                  {/* Issues */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Detected Issues
                    </h4>
                    <ul className="space-y-1.5">
                      {risk.issues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                          <span className="text-gray-600 mt-0.5 flex-shrink-0">•</span>
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* AI Suggestion */}
                  {suggestion && (
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Lightbulb size={14} className="text-yellow-400" />
                        <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex-1">
                          AI Modernization Suggestion
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                        {suggestion.suggestion}
                      </p>
                      {suggestion.diff && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              Before / After
                            </p>
                            <CopyButton text={suggestion.diff} />
                          </div>
                          <pre className="text-xs text-green-300 bg-gray-950 rounded p-3 overflow-x-auto whitespace-pre-wrap">
                            {suggestion.diff}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* No suggestion yet */}
                  {!suggestion && (
                    <p className="text-xs text-gray-600 italic">
                      AI suggestion not available for this file — only the top few riskiest files are sent to Bob by default.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
