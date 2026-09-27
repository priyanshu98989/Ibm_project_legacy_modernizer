/**
 * client/src/App.jsx
 * Root component.  Manages the top-level view state:
 *   idle/uploading/pending/analyzing → UploadPanel or AnalyzingScreen
 *   done                             → ReportDashboard
 *   error                            → Error banner + reset
 */

import { AlertTriangle, RotateCcw } from 'lucide-react';
import UploadPanel from './components/UploadPanel';
import AnalyzingScreen from './components/AnalyzingScreen';
import ReportDashboard from './components/ReportDashboard';
import { useAnalysis } from './hooks/useAnalysis';

export default function App() {
  const {
    phase,
    uploadProgress,
    jobId,
    report,
    errorMsg,
    submitZip,
    submitUrl,
    submitDemo,
    reset,
  } = useAnalysis();

  // ── Error screen ────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-red-900 rounded-2xl p-8 w-full max-w-md text-center">
          <AlertTriangle size={40} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-white text-xl font-semibold mb-2">Analysis Failed</h2>
          <p className="text-gray-400 text-sm mb-6 break-words">{errorMsg}</p>
          <button
            onClick={reset}
            className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-blue-700 hover:bg-blue-600
                       text-white rounded-lg font-medium text-sm transition-colors"
          >
            <RotateCcw size={14} /> Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Report view ─────────────────────────────────────────────────────────────
  if (phase === 'done' && report) {
    return <ReportDashboard report={report} jobId={jobId} onReset={reset} />;
  }

  // ── Loading / analyzing ─────────────────────────────────────────────────────
  if (phase !== 'idle') {
    return <AnalyzingScreen phase={phase} uploadProgress={uploadProgress} />;
  }

  // ── Upload screen (default) ─────────────────────────────────────────────────
  return <UploadPanel onZip={submitZip} onUrl={submitUrl} onDemo={submitDemo} />;
}
