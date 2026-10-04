"use client";

import { memo, type CSSProperties, type RefObject } from "react";
import type { JarvisState, VoiceState } from "@/types";
import { getCoreHumanStatus, getCoreVisualState } from "@/lib/presentation/core-state";

const outerTicks = Array.from({ length: 96 }, (_, i) => i);
const bandTicks = Array.from({ length: 72 }, (_, i) => i);
const signalDots = Array.from({ length: 12 }, (_, i) => i);
const voiceBars = Array.from({ length: 31 }, (_, i) => ({ x: 204 + i * 3.7, halfHeight: 3 + ((i * 7 + i * i * 3) % 13), weight: .35 + ((i * 11) % 9) / 10 }));

type Props = { state: JarvisState; voiceState?: VoiceState; operation?: string | null; stageRef?: RefObject<HTMLElement | null>; onActivate?: () => void; voiceActive?: boolean };

// Geometry is static. Live microphone/playback energy changes CSS variables on the stage.
export const JarvisCore = memo(function JarvisCore({ state, voiceState = "idle", operation, stageRef, onActivate, voiceActive = false }: Props) {
  const visualState = getCoreVisualState(state, voiceState);
  const humanStatus = getCoreHumanStatus(state, voiceState);
  return <section ref={stageRef} className={`jarvis-core-stage core-is-${visualState}`} aria-label={`JARVIS: ${humanStatus}`}>
    <div className="core-blueprint" aria-hidden="true"><i className="panel-a" /><i className="panel-b" /><i className="panel-c" /><i className="panel-d" /></div>
    <svg className={`jarvis-core-visual ${onActivate ? "core-actionable" : ""}`} viewBox="0 0 520 520" role={onActivate ? "button" : "img"} tabIndex={onActivate ? 0 : undefined} aria-label={onActivate ? voiceActive ? "Κλείσιμο φωνής JARVIS" : "Πατήστε για να μιλήσετε στον JARVIS" : "Ζωντανός ολογραφικός πυρήνας JARVIS"} aria-pressed={onActivate ? voiceActive : undefined} onClick={onActivate} onKeyDown={onActivate ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(); } } : undefined}>
      <defs>
        <radialGradient id="jarvisDisc"><stop offset="0" stopColor="#06131b" /><stop offset=".7" stopColor="#071b25" /><stop offset="1" stopColor="#15506d" /></radialGradient>
        <radialGradient id="jarvisCenterGlow"><stop offset="0" stopColor="#69e9ff" stopOpacity=".22" /><stop offset=".5" stopColor="#2fbddd" stopOpacity=".07" /><stop offset="1" stopColor="#071720" stopOpacity="0" /></radialGradient>
        <linearGradient id="jarvisBand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a0efff" /><stop offset=".42" stopColor="#297fab" /><stop offset=".74" stopColor="#4bc4eb" /><stop offset="1" stopColor="#154b71" /></linearGradient>
        <linearGradient id="jarvisArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5bdcff" /><stop offset=".5" stopColor="#d6ffff" /><stop offset="1" stopColor="#40b8df" /></linearGradient>
        <filter id="jarvisSoftGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id="jarvisTextGlow" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <pattern id="jarvisMicroGrid" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M15 0H0V15" fill="none" stroke="#70d9f6" strokeOpacity=".1" strokeWidth=".5" /></pattern>
      </defs>
      <circle cx="260" cy="260" r="225" fill="transparent" />
      <g className="core-technical-field">
        <circle cx="260" cy="260" r="237" fill="#0b2c3b" fillOpacity=".24" /><circle cx="260" cy="260" r="237" fill="url(#jarvisMicroGrid)" opacity=".55" />
        <circle cx="260" cy="260" r="233" fill="none" stroke="#63b5ce" strokeOpacity=".12" strokeWidth=".7" strokeDasharray="4 7" />
        <path d="M38 260H482M260 26V494M73 104H150M371 104H447M73 416H150M371 416H447" fill="none" stroke="#73d8ef" strokeOpacity=".14" strokeWidth=".7" />
        <path d="M74 116h25v-16h30M431 115h-28V96h-30M75 398h29v19h31M433 400h-29v18h-31" fill="none" stroke="#73d8ef" strokeOpacity=".2" strokeWidth=".7" />
        <text x="77" y="126">SYS.01 / ACTIVE</text><text x="382" y="126">ARC.209</text><text x="80" y="411">LIFE SUPPORT</text><text x="382" y="411">EL-GR</text>
      </g>
      <circle className="core-ambient-glow" cx="260" cy="260" r="202" />
      <g className="core-outer-shell">
        <circle cx="260" cy="260" r="212" className="core-hairline" /><circle cx="260" cy="260" r="203" className="core-outer-glow" />
        <circle cx="260" cy="260" r="203" className="core-outer-arc arc-one" pathLength="100" /><circle cx="260" cy="260" r="203" className="core-outer-arc arc-two" pathLength="100" />
        <circle cx="260" cy="260" r="198" className="core-hairline core-hairline-dashed" />
        <path d="M125 108l20-16m234 16-20-16M81 327l-8-19M449 322l6-20" className="core-shell-brackets" />
      </g>
      <g className="core-outer-ticks">{outerTicks.map((i) => <line key={i} x1="260" y1="65" x2="260" y2={i % 8 === 0 ? 83 : i % 2 === 0 ? 75 : 71} transform={`rotate(${i * 3.75} 260 260)`} />)}</g>
      <g className="core-orbit-rotor core-orbit-rotor-a">
        <circle cx="260" cy="260" r="180" className="core-rotor-track" /><circle cx="260" cy="260" r="181" className="core-rotor-segments" pathLength="100" /><circle cx="260" cy="260" r="174" className="core-rotor-fine" pathLength="100" />
      </g>
      <g className="core-band-group">
        <circle cx="260" cy="260" r="153" className="core-band-shadow" /><circle cx="260" cy="260" r="153" className="core-band" />
        <circle cx="260" cy="260" r="171" className="core-band-edge" /><circle cx="260" cy="260" r="135" className="core-band-edge inner" />
        <circle cx="260" cy="260" r="153" className="core-band-scoring" pathLength="100" />
        {bandTicks.map((i) => <line key={i} x1="260" y1="91" x2="260" y2={i % 6 === 0 ? 112 : 104} transform={`rotate(${i * 5} 260 260)`} />)}
      </g>
      <g className="core-inner-ring core-orbit-rotor core-orbit-rotor-b">
        <circle cx="260" cy="260" r="128" className="core-inner-hairline" /><circle cx="260" cy="260" r="123" className="core-inner-arc" pathLength="100" /><circle cx="260" cy="260" r="117" className="core-inner-data" pathLength="100" />
        {signalDots.map((i) => <circle key={i} cx="260" cy="127" r={i % 3 === 0 ? 2.1 : 1.25} transform={`rotate(${i * 30} 260 260)`} className="core-signal-dot" />)}
      </g>
      <circle cx="260" cy="260" r="112" className="core-disc" /><circle cx="260" cy="260" r="108" fill="url(#jarvisCenterGlow)" className="core-disc-light" />
      <g className="core-disc-detail"><circle cx="260" cy="260" r="98" /><circle cx="260" cy="260" r="72" /><circle cx="260" cy="260" r="53" /><path d="M155 260h210M260 155v210M176 176l168 168M344 176L176 344" /><path d="M196 213h24v-10h22M325 208h-25v-12h-14M194 311h33v10h21M328 312h-31v10h-19" /></g>
      <g className="core-scan"><path d="M259 149v222" /><circle cx="260" cy="260" r="103" /></g>
      <g className="core-orange-accents"><circle cx="260" cy="260" r="139" pathLength="100" className="core-amber-main" /><circle cx="260" cy="260" r="126" pathLength="100" className="core-amber-fine" />{Array.from({ length: 7 }, (_, i) => <circle key={i} cx="260" cy="121" r="1.6" transform={`rotate(${-20 + i * 7} 260 260)`} className="core-amber-dots" />)}</g>
      <g className="core-live-pulse" aria-hidden="true"><circle cx="260" cy="260" r="164" className="core-pulse-outer" /><circle cx="260" cy="260" r="109" className="core-pulse-inner" /></g>
      <circle cx="260" cy="260" r="115" className="core-reactive-halo" />
      <g className="core-center-lockup" filter="url(#jarvisTextGlow)"><path d="M172 237h176M172 281h176" className="core-word-lines" /><text x="260" y="267" textAnchor="middle">J.A.R.V.I.S.</text></g>
      <g className="core-voice-bars" aria-hidden="true">{voiceBars.map((bar, index) => <line key={index} x1={bar.x} x2={bar.x} y1={294 - bar.halfHeight} y2={294 + bar.halfHeight} style={{ "--wave-weight": bar.weight } as CSSProperties} />)}</g>
      <g className="core-bottom-data"><path d="M190 303h54m31 0h55" /><text x="260" y="321" textAnchor="middle">JUST A RATHER VERY INTELLIGENT SYSTEM</text></g>
    </svg>
    <div className="core-readout" aria-hidden="true"><span className="core-status-dot" /><span>{operation ?? humanStatus}</span>{onActivate && <span className="core-action-hint">{voiceActive ? "ΠΑΤΗΣΤΕ ΓΙΑ ΔΙΑΚΟΠΗ ΦΩΝΗΣ" : "ΠΑΤΗΣΤΕ ΓΙΑ ΝΑ ΜΙΛΗΣΕΤΕ"}</span>}</div>
  </section>;
});
