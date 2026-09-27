/**
 * client/src/hooks/useAnalysis.js
 * Custom hook that manages the full upload → analyze → poll → report lifecycle.
 *
 * State machine:
 *   idle → uploading → pending → analyzing → done | error
 */

import { useState, useRef, useCallback } from 'react';
import { uploadZip, submitRepoUrl, startAnalysis, getJobStatus, fetchReport, loadDemoFixture } from '../api';

const POLL_INTERVAL_MS = 2000;

export function useAnalysis() {
  const [phase, setPhase]           = useState('idle');    // idle|uploading|pending|analyzing|done|error
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobId, setJobId]           = useState(null);
  const [report, setReport]         = useState(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const pollRef = useRef(null);

  /** Stop any running poll timer */
  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  /** Start polling the job status until done or error */
  const startPolling = useCallback((id) => {
    clearPoll();
    pollRef.current = setInterval(async () => {
      try {
        const { status, error } = await getJobStatus(id);
        if (status === 'done') {
          clearPoll();
          setPhase('done');
          const r = await fetchReport(id);
          setReport(r);
        } else if (status === 'error') {
          clearPoll();
          setPhase('error');
          setErrorMsg(error || 'Analysis failed.');
        } else {
          setPhase(status); // 'pending' or 'analyzing'
        }
      } catch (err) {
        clearPoll();
        setPhase('error');
        setErrorMsg(err.message);
      }
    }, POLL_INTERVAL_MS);
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
      setJobId(id);
      setPhase('pending');
      // Kick off analysis immediately
      await startAnalysis(id);
      setPhase('analyzing');
      startPolling(id);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }, [startPolling]);

  /**
   * Submit a GitHub repo URL.
   * @param {string} url
   */
  const submitUrl = useCallback(async (url) => {
    try {
      setPhase('uploading');
      setErrorMsg('');
      const { jobId: id } = await submitRepoUrl(url);
      setJobId(id);
      setPhase('pending');
      // The server clones async; poll until workDir is ready, then start analysis.
      // startAnalysis returns 202 { status:'pending' } while clone is in progress.
      const waitForClone = async () => {
        try {
          const { status, error } = await getJobStatus(id);
          if (status === 'error') {
            setPhase('error');
            setErrorMsg(error || 'Repository clone failed.');
            return;
          }
          // Try to kick off analysis; server replies 202 if clone not done yet
          const res = await startAnalysis(id);
          if (res.status === 'analyzing' || res.status === 'done') {
            setPhase('analyzing');
            startPolling(id);
            return;
          }
          // Still pending — try again after 2 s
          setTimeout(waitForClone, 2000);
        } catch (err) {
          // startAnalysis may throw on network error; keep retrying for clone-pending case
          setTimeout(waitForClone, 2000);
        }
      };
      waitForClone();
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }, [startPolling]);

  /**
   * Load a pre-built demo fixture by name (bypasses upload entirely).
   * @param {string} fixtureName
   */
  const submitDemo = useCallback(async (fixtureName) => {
    try {
      setPhase('uploading');
      setUploadProgress(100);
      setErrorMsg('');
      const { jobId: id } = await loadDemoFixture(fixtureName);
      setJobId(id);
      setPhase('pending');
      await startAnalysis(id);
      setPhase('analyzing');
      startPolling(id);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }, [startPolling]);

  /** Reset everything back to idle */
  const reset = useCallback(() => {
    clearPoll();
    setPhase('idle');
    setJobId(null);
    setReport(null);
    setErrorMsg('');
    setUploadProgress(0);
  }, []);

  return { phase, uploadProgress, jobId, report, errorMsg, submitZip, submitUrl, submitDemo, reset };
}
