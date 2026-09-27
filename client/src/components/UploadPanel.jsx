/**
 * client/src/components/UploadPanel.jsx
 * The landing / upload screen.
 * Supports drag-and-drop ZIP upload, GitHub URL input, or instant demo fixture loading.
 */

import { useState, useRef } from 'react';
import { Upload, Github, AlertCircle, FlaskConical } from 'lucide-react';

const DEMO_FIXTURES = [
  {
    name: 'java-legacy-bank',
    label: 'Java Legacy Bank',
    description: '4-file Java banking service — Vector, Hashtable, raw JDBC, no tests.',
    tags: ['Java', '4 files', 'High risk'],
  },
  {
    name: 'cobol-legacy-payroll',
    label: 'COBOL Legacy Payroll',
    description: '4-file COBOL batch payroll — GO TO spaghetti, EXEC SQL, hardcoded paths.',
    tags: ['COBOL', '4 files', 'High risk'],
  },
  {
    name: 'cobol-java-demo',
    label: 'Java + COBOL Mix',
    description: 'Mixed customer inquiry system — Java service + COBOL inquiry program.',
    tags: ['Java', 'COBOL', '4 files'],
  },
];

/**
 * @param {{
 *   onZip:  (file: File) => void,
 *   onUrl:  (url: string) => void,
 *   onDemo: (fixtureName: string) => void,
 * }} props
 */
export default function UploadPanel({ onZip, onUrl, onDemo }) {
  const [tab, setTab]           = useState('demo'); // 'demo' | 'zip' | 'url'
  const [repoUrl, setRepoUrl]   = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [zipPreview, setZipPreview] = useState(null); // { name, sizeKb }
  const fileInputRef = useRef(null);

  // ── Drag-and-drop ───────────────────────────────────────────────────────────
  const handleDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSubmitZip(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) validateAndSubmitZip(file);
  };

  const validateAndSubmitZip = (file) => {
    if (!file.name.endsWith('.zip')) {
      alert('Please upload a .zip archive.');
      return;
    }
    setZipPreview({ name: file.name, sizeKb: Math.round(file.size / 1024) });
    onZip(file);
  };

  // ── URL submit ──────────────────────────────────────────────────────────────
  const handleUrlSubmit = (e) => {
    e.preventDefault();
    const trimmed = repoUrl.trim();
    if (!/^https?:\/\/.+/.test(trimmed)) {
      setUrlError('Please enter a valid http/https URL.');
      return;
    }
    setUrlError('');
    onUrl(trimmed);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="text-5xl mb-4">🔬</div>
        <h1 className="text-4xl font-bold text-white tracking-tight">Legacy Code Modernizer</h1>
        <p className="mt-3 text-gray-400 text-lg max-w-xl">
          Upload your legacy codebase and get an AI-powered modernization plan with dependency maps,
          risk scores, and refactoring suggestions.
        </p>
        <div className="mt-3 flex gap-2 justify-center text-sm text-gray-500">
          <span className="bg-gray-800 rounded px-2 py-0.5">Java</span>
          <span className="bg-gray-800 rounded px-2 py-0.5">COBOL</span>
          <span className="bg-gray-700 text-gray-400 rounded px-2 py-0.5">JavaScript</span>
        </div>
      </div>

      {/* Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-xl">
        {/* Tab switcher */}
        <div className="flex border-b border-gray-800">
          {[
            { id: 'demo', label: 'Try a Demo',  Icon: FlaskConical },
            { id: 'zip',  label: 'Upload ZIP',  Icon: Upload       },
            { id: 'url',  label: 'GitHub URL',  Icon: Github       },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors
                ${tab === id
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-900'
                  : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              <Icon size={15} />{label}
            </button>
          ))}
        </div>

        <div className="p-6">

          {/* ── Demo Tab ── */}
          {tab === 'demo' && (
            <div className="space-y-3">
              <p className="text-gray-400 text-sm mb-4">
                Instantly analyse a pre-loaded legacy codebase — no upload required.
                Perfect for a quick demo or to explore the tool's output.
              </p>
              {DEMO_FIXTURES.map((fx) => (
                <button
                  key={fx.name}
                  onClick={() => onDemo(fx.name)}
                  className="w-full text-left bg-gray-800 hover:bg-gray-700 border border-gray-700
                             hover:border-blue-600 rounded-xl p-4 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-white font-semibold text-sm group-hover:text-blue-300 transition-colors">
                        {fx.label}
                      </p>
                      <p className="text-gray-400 text-xs mt-1">{fx.description}</p>
                    </div>
                    <span className="text-blue-500 text-xs font-medium shrink-0 mt-0.5">Run →</span>
                  </div>
                  <div className="flex gap-1.5 mt-2.5 flex-wrap">
                    {fx.tags.map(t => (
                      <span key={t} className="bg-gray-700 text-gray-300 text-xs rounded px-1.5 py-0.5">{t}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ── ZIP Tab ── */}
          {tab === 'zip' && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors
                ${dragOver
                  ? 'border-blue-500 bg-blue-950/30'
                  : 'border-gray-700 hover:border-gray-500 hover:bg-gray-800/30'
                }`}
            >
              <Upload size={36} className="text-gray-500" />
              <p className="text-gray-300 font-medium">Drag & drop your ZIP archive here</p>
              <p className="text-gray-500 text-sm">or click to browse</p>
              <p className="text-gray-600 text-xs mt-1">Max 50 MB · .zip files only · up to 500 source files</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleFileChange}
              />
              {zipPreview && (
                <div className="mt-2 flex items-center gap-2 bg-blue-950/40 border border-blue-800 rounded-lg px-3 py-2 text-xs">
                  <span className="text-blue-300 font-medium truncate max-w-[200px]">{zipPreview.name}</span>
                  <span className="text-blue-500 shrink-0">{zipPreview.sizeKb} KB</span>
                </div>
              )}
            </div>
          )}

          {/* ── URL Tab ── */}
          {tab === 'url' && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Public GitHub Repository URL</label>
                <input
                  type="url"
                  value={repoUrl}
                  onChange={e => { setRepoUrl(e.target.value); setUrlError(''); }}
                  placeholder="https://github.com/owner/repo"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white
                             placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                />
                {urlError && (
                  <p className="mt-1.5 text-red-400 text-xs flex items-center gap-1">
                    <AlertCircle size={12} />{urlError}
                  </p>
                )}
              </div>
              <p className="text-gray-600 text-xs">
                Only public repositories. Shallow-cloned (depth 1). Times out after 5 minutes.
              </p>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg
                           transition-colors text-sm"
              >
                Analyse Repository
              </button>
            </form>
          )}

        </div>
      </div>

      {/* Disclaimer */}
      <p className="mt-6 text-gray-600 text-xs text-center max-w-sm">
        Code is processed on your local server and never leaves your environment.
        AI suggestions are powered by IBM Bob.
      </p>
    </div>
  );
}
