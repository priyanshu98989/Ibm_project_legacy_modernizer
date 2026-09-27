/**
 * client/src/hooks/useAnalysis.js
 * Custom hook that manages the full upload → analyse → report lifecycle.
 *
 * State machine:
 *   idle → uploading → analyzing → done | error
 *
 * There is no polling phase any more.  The server used to acknowledge an
 * analysis job and keep working in the background while the client asked for
 * status every two seconds; that only works when the server is a long-lived
 * process.  The analysis is now one awaited request that resolves with the
 * report, so the hook awaits it directly.
 */

import { useState, useCallback } from 'react';
import { uploadZip, submitRepoUrl, runAnalysis, runDemo } from '../api';

export function useAnalysis() {
  const [phase, setPhase]           = useState('idle');    // idle|uploading|analyzing|done|error
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobId, setJobId]           = useState(null);
  const [report, setReport]         = useState(null);
  const [errorMsg, setErrorMsg]     = useState('');

  /** Common tail: finish successfully with a report, or fail with a message. */
  const settle = useCallback(async (id) => {
    const { report: finished } = await runAnalysis(id);
    setJobId(id);
    setReport(finished);
    setPhase('done');
  }, []);

  /**
   * Submit a ZIP file.
   * @param {File} file
   */
  const submitZip = useCallback(async (file) => {
    try {
      setPhase('uploading');
      setUploadProgress(0);
      setErrorMsg('');
      const { jobId: id } = await uploadZip(file, setUploadProgress);
      setUploadProgress(100);
      setPhase('analyzing');
      await settle(id);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }, [settle]);

  /**
   * Submit a GitHub repo URL.  The clone happens server-side during the
   * analysis request, so there is no separate "cloning" phase to show.
   * @param {string} url
   */
  const submitUrl = useCallback(async (url) => {
    try {
      setPhase('uploading');
      setUploadProgress(100);
      setErrorMsg('');
      const { jobId: id } = await submitRepoUrl(url);
      setPhase('analyzing');
      await settle(id);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }, [settle]);

  /**
   * Analyse a pre-built demo fixture.  Also a single request — the fixture is
   * already on the server, so there is nothing to upload and nothing to wait on
   * between steps.
   * @param {string} fixtureName
   */
  const submitDemo = useCallback(async (fixtureName) => {
    try {
      setPhase('uploading');
      setUploadProgress(100);
      setErrorMsg('');
      const { jobId: id, report: finished } = await runDemo(fixtureName);
      setJobId(id);
      setReport(finished);
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }, []);

  /** Reset everything back to idle */
  const reset = useCallback(() => {
    setPhase('idle');
    setJobId(null);
    setReport(null);
    setErrorMsg('');
    setUploadProgress(0);
  }, []);

  return { phase, uploadProgress, jobId, report, errorMsg, submitZip, submitUrl, submitDemo, reset };
}
