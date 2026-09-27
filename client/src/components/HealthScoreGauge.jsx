/**
 * client/src/components/HealthScoreGauge.jsx
 * SVG arc gauge showing the overall codebase health score (0–100).
 * Animates the arc on mount using CSS transition on stroke-dashoffset.
 */

import { useEffect, useRef } from 'react';

export default function HealthScoreGauge({ score }) {
  const arcRef = useRef(null);

  const radius    = 70;
  const cx        = 100;
  const cy        = 90;
  const startAngle = -200;
  const endAngle   = 20;
  const sweep      = endAngle - startAngle; // 220°

  const toRad      = (deg) => (deg * Math.PI) / 180;
  const polarToXY  = (angle, r) => ({
    x: cx + r * Math.cos(toRad(angle)),
    y: cy + r * Math.sin(toRad(angle)),
  });

  const start    = polarToXY(startAngle, radius);
  const end      = polarToXY(endAngle, radius);
  const large    = sweep > 180 ? 1 : 0;
  const trackPath = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;

  // Compute arc length for the full track so we can animate stroke-dashoffset
  const circumference = (sweep / 360) * 2 * Math.PI * radius;
  const fillLength    = (score / 100) * circumference;

  // Animate from 0 to fillLength on mount
  useEffect(() => {
    if (!arcRef.current) return;
    // Start at 0 (hidden), then transition to the target length
    arcRef.current.style.strokeDashoffset = circumference;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        arcRef.current.style.strokeDashoffset = circumference - fillLength;
      });
    });
  }, [score, circumference, fillLength]);

  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444';
  const label = score >= 70 ? 'Good'    : score >= 40 ? 'Fair'    : 'Critical';
  const ringBg = score >= 70 ? '#14532d' : score >= 40 ? '#422006' : '#450a0a';

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 130" className="w-48 h-32">
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="#1e293b"
          strokeWidth={14}
          strokeLinecap="round"
        />
        {/* Animated value arc */}
        <path
          ref={arcRef}
          d={trackPath}
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        {/* Score text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize={28} fontWeight="700">
          {score}
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" fill="#94a3b8" fontSize={13}>
          / 100
        </text>
      </svg>
      <span
        className="text-sm font-bold px-3 py-1 rounded-full mt-1"
        style={{ color, backgroundColor: ringBg }}
      >
        {label}
      </span>
    </div>
  );
}
