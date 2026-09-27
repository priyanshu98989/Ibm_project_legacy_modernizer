/**
 * client/src/components/AnalyzingScreen.jsx
 * Loading / progress screen shown while analysis is running.
 */

import { Loader2 } from 'lucide-react';

const PHASE_LABELS = {
  uploading: 'Uploading archive…',
  pending:   'Cloning repository / preparing workspace…',
  analyzing: 'Running static analysis and generating AI suggestions…',
};

const STEPS = [
  { key: 'upload',    label: 'File upload & extraction',              phase: 'uploading' },
  { key: 'pending',   label: 'Preparing workspace / cloning repo…',   phase: 'pending'   },
  { key: 'parse',     label: 'Language parsing (Java / COBOL / JS)',  phase: 'analyzing' },
  { key: 'depgraph',  label: 'Dependency graph construction',         phase: 'analyzing' },
  { key: 'risk',      label: 'Static risk scoring',                   phase: 'analyzing' },
  { key: 'bob',       label: 'AI modernization suggestions (Bob)',    phase: 'analyzing' },
];

// Map phase → how many steps are fully done
const PHASE_STEPS_DONE = {
  uploading: 0,
  pending:   1,
  analyzing: 2,
};

/**
 * @param {{ phase: string, uploadProgress: number }} props
 */
export default function AnalyzingScreen({ phase, uploadProgress }) {
  const stepsDone = PHASE_STEPS_DONE[phase] ?? 0;
  // The "active" step animates; steps beyond it are greyed out

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md shadow-xl">
        {/* Spinner + label */}
        <div className="flex items-center gap-3 mb-6">
          <Loader2 size={28} className="text-blue-400 animate-spin flex-shrink-0" />
          <div>
            <h2 className="text-white font-semibold text-lg">Analysing your codebase</h2>
            <p className="text-gray-400 text-sm mt-0.5">{PHASE_LABELS[phase] || 'Working…'}</p>
          </div>
        </div>

        {/* Upload progress bar */}
        {phase === 'uploading' && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Uploading</span><span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Step list */}
        <ul className="space-y-3">
          {STEPS.map((step, i) => {
            const done = i < stepsDone;
            const active = i === stepsDone;
            return (
              <li key={step.key} className="flex items-center gap-3 text-sm">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold
                    ${done   ? 'bg-green-600 text-white' :
                      active ? 'bg-blue-600 text-white animate-pulse' :
                               'bg-gray-800 text-gray-600'
                    }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className={done ? 'text-gray-400 line-through' : active ? 'text-white' : 'text-gray-600'}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-gray-600 text-xs text-center">
          AI suggestions may take a minute — Bob is reading your code…
        </p>
      </div>
    </div>
  );
}
