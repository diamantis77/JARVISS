"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMicrophoneMeter, classifyAmbientNoise, createCalibration, getMicrophonePermission, listAudioInputs, type AmbientNoise, type MicrophonePermission } from "@/lib/voice/browser-audio";
import { BrowserLocalWakeWordProvider } from "@/lib/voice/browser-wake-word-provider";
import { defaultPersonalJarvisPreferences, parsePersonalJarvisPreferences, PERSONAL_PREFERENCES_KEY, type PersonalJarvisPreferences } from "@/lib/personal-preferences";
import type { WeatherSnapshot } from "@/lib/weather/contracts";

const permissionLabel: Record<MicrophonePermission, string> = { granted: "Επιτρέπεται", prompt: "Δεν έχει ζητηθεί", denied: "Απορρίφθηκε", unavailable: "Μη διαθέσιμο" };
const noiseLabel: Record<AmbientNoise, string> = { low: "Low", medium: "Medium", high: "High", unknown: "Δεν μετρήθηκε" };

export function VoiceDiagnostics({ deviceId, language, onDeviceChange }: { deviceId: string; language: string; onDeviceChange(deviceId: string): void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [permission, setPermission] = useState<MicrophonePermission>("prompt");
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [noise, setNoise] = useState<AmbientNoise>("unknown");
  const [deviceStatus, setDeviceStatus] = useState("Δεν έχει ελεγχθεί");
  const [calibrationStep, setCalibrationStep] = useState("");
  const [wakeStatus, setWakeStatus] = useState("Δεν έχει ελεγχθεί");
  const [wakeAttempts, setWakeAttempts] = useState<Array<{ confidence: number; transcript: string }>>([]);
  const [wakeTesting, setWakeTesting] = useState(false);
  const [wakeError, setWakeError] = useState("");
  const [lastWakeRecognition, setLastWakeRecognition] = useState("");
  const [wakeSignals, setWakeSignals] = useState({ pack: "unknown", started: 0, speech: 0, result: 0, noSpeech: 0, ended: 0 });
  const [preferences, setPreferences] = useState<PersonalJarvisPreferences>(defaultPersonalJarvisPreferences);
  const [locationStatus, setLocationStatus] = useState("Δεν έχει ζητηθεί");
  const [locationWeather, setLocationWeather] = useState<WeatherSnapshot | null>(null);
  const meterRef = useRef<BrowserMicrophoneMeter | null>(null);
  const meterFrameRef = useRef(0);
  const levelSamplesRef = useRef<number[]>([]);
  const wakeProviderRef = useRef<BrowserLocalWakeWordProvider | null>(null);
  const wakeCancelledRef = useRef(false);
  const wakeCountRef = useRef(0);

  const refreshDevices = async () => {
    setPermission(await getMicrophonePermission());
    setDevices(await listAudioInputs().catch(() => []));
  };

  useEffect(() => {
    setPreferences(parsePersonalJarvisPreferences(localStorage.getItem(PERSONAL_PREFERENCES_KEY)));
    void refreshDevices();
    const listener = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", listener);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", listener);
      cancelAnimationFrame(meterFrameRef.current);
      void meterRef.current?.stop();
      void wakeProviderRef.current?.stop();
    };
  }, []);

  const savePreferences = (patch: Partial<PersonalJarvisPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(PERSONAL_PREFERENCES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const stopMeter = async () => {
    cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = 0;
    await meterRef.current?.stop();
    meterRef.current = null;
    setTesting(false);
    setLevel(0);
  };

  const startMeter = async () => {
    if (meterRef.current) return meterRef.current;
    const meter = new BrowserMicrophoneMeter();
    try {
      const stream = await meter.start(deviceId);
      meterRef.current = meter;
      setPermission("granted");
      setDeviceStatus(stream.getAudioTracks()[0]?.readyState === "live" ? "Συνδεδεμένο" : "Μη διαθέσιμο");
      await refreshDevices();
      const tick = () => {
        const reading = meter.read();
        setLevel(reading.level);
        setSampleRate(reading.sampleRate);
        levelSamplesRef.current = [...levelSamplesRef.current.slice(-79), reading.level];
        if (levelSamplesRef.current.length >= 30) {
          const average = levelSamplesRef.current.reduce((total, value) => total + value, 0) / levelSamplesRef.current.length;
          setNoise(classifyAmbientNoise(average));
        }
        meterFrameRef.current = requestAnimationFrame(tick);
      };
      meterFrameRef.current = requestAnimationFrame(tick);
      setTesting(true);
      return meter;
    } catch (error) {
      setPermission(await getMicrophonePermission());
      setDeviceStatus(error instanceof DOMException && error.name === "NotFoundError" ? "Δεν βρέθηκε" : "Αποτυχία σύνδεσης");
      await meter.stop();
      return null;
    }
  };

  const collect = async (durationMs: number) => {
    const samples: number[] = [];
    const started = performance.now();
    while (performance.now() - started < durationMs) {
      if (meterRef.current) samples.push(meterRef.current.read().level);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return samples;
  };

  const calibrate = async () => {
    if (!await startMeter()) return;
    setCalibrationStep("Μείνετε ήσυχος για 2 δευτερόλεπτα…");
    const background = await collect(2_000);
    setCalibrationStep("Πείτε φυσικά: «Hey Jarvis»");
    const voice = await collect(3_200);
    const calibration = createCalibration(background, voice);
    if (calibration) {
      savePreferences({ calibration });
      setCalibrationStep("Η βαθμονόμηση ολοκληρώθηκε και αποθηκεύτηκαν μόνο επίπεδα, όχι ήχος.");
    } else setCalibrationStep("Δεν μετρήθηκε αρκετή διαφορά φωνής/θορύβου. Δοκιμάστε ξανά πιο κοντά στο μικρόφωνο.");
  };

  const startWakeAttempt = async () => {
    if (wakeCancelledRef.current || wakeCountRef.current >= 5) return;
    setWakeStatus(`Έτοιμο · προσπάθεια ${wakeCountRef.current + 1} από 5`);
    const provider = new BrowserLocalWakeWordProvider({
      onState: (snapshot) => {
        if (snapshot.error) { setWakeError(snapshot.error); setWakeStatus("Not Ready"); setWakeTesting(false); wakeCancelledRef.current = true; }
        else if (snapshot.state === "wake_waiting") setWakeStatus(`Ready · πείτε «Hey Jarvis» (${wakeCountRef.current + 1}/5)`);
      },
      onDetected: async (transcript, confidence) => {
        wakeCountRef.current += 1;
        setWakeAttempts((current) => [...current, { confidence, transcript }]);
        setWakeStatus(`✓ Εντοπίστηκε «Hey Jarvis» · ${wakeCountRef.current}/5`);
        await provider.stop();
        wakeProviderRef.current = null;
        if (wakeCountRef.current >= 5) { setWakeTesting(false); return; }
        window.setTimeout(() => void startWakeAttempt(), 500);
      },
      onRecognitionResult: (transcript) => setLastWakeRecognition(transcript.slice(0, 160)),
      onDiagnostic: (event) => setWakeSignals((current) => ({
        ...current,
        pack: event === "pack-dictation" ? "dictation" : event === "pack-command" ? "command" : event === "pack-unverified" ? "unverified" : current.pack,
        started: current.started + Number(event === "started"),
        speech: current.speech + Number(event === "speech"),
        result: current.result + Number(event === "result"),
        noSpeech: current.noSpeech + Number(event === "no-speech"),
        ended: current.ended + Number(event === "ended"),
      })),
    });
    wakeProviderRef.current = provider;
    await provider.start({ phrase: "Hey Jarvis", language, microphoneDeviceId: deviceId, sensitivity: preferences.wakeSensitivity, speechThreshold: preferences.calibration?.speechThreshold });
  };

  const toggleWakeTest = async () => {
    if (wakeTesting) {
      wakeCancelledRef.current = true;
      await wakeProviderRef.current?.stop();
      wakeProviderRef.current = null;
      setWakeTesting(false);
      setWakeStatus("Η δοκιμή σταμάτησε");
      return;
    }
    await stopMeter();
    wakeCancelledRef.current = false;
    wakeCountRef.current = 0;
    setWakeAttempts([]);
    setLastWakeRecognition("");
    setWakeSignals({ pack: "unknown", started: 0, speech: 0, result: 0, noSpeech: 0, ended: 0 });
    setWakeError("");
    setWakeTesting(true);
    await startWakeAttempt();
  };

  const requestLocation = () => {
    if (!navigator.geolocation) { setLocationStatus("Η τοποθεσία δεν υποστηρίζεται"); return; }
    setLocationStatus("Αναμονή άδειας…");
    navigator.geolocation.getCurrentPosition(async (position) => {
      savePreferences({ automaticLocation: true });
      setLocationStatus("Εγκρίθηκε · οι συντεταγμένες δεν αποθηκεύτηκαν");
      const result = await fetch("/api/weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }) });
      const data = await result.json().catch(() => null) as { weather?: WeatherSnapshot } | null;
      setLocationWeather(data?.weather ?? null);
    }, () => { savePreferences({ automaticLocation: false }); setLocationStatus("Η άδεια απορρίφθηκε · θα χρησιμοποιηθεί η χειροκίνητη πόλη"); }, { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 10_000 });
  };

  const selected = devices.find((device) => device.deviceId === deviceId);
  return <section className="personal-jarvis-settings wide">
    <p className="panel-title">ΠΡΟΣΩΠΙΚΟΣ JARVIS · ΦΩΝΗ & ΜΙΚΡΟΦΩΝΟ</p>
    <div className="settings-grid">
      <label>Επιλεγμένο μικρόφωνο<select value={deviceId} onChange={(event) => onDeviceChange(event.target.value)}><option value="">Προεπιλογή συστήματος</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Μικρόφωνο ${index + 1}`}</option>)}</select></label>
      <label>Wake sensitivity<select value={preferences.wakeSensitivity} onChange={(event) => savePreferences({ wakeSensitivity: event.target.value as PersonalJarvisPreferences["wakeSensitivity"] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
    </div>
    <div className="voice-diagnostic-grid" aria-live="polite">
      <div><small>Μικρόφωνο</small><b>{deviceStatus}</b><span>{selected?.label || "Προεπιλογή συστήματος"}</span></div>
      <div><small>Άδεια</small><b>{permissionLabel[permission]}</b><span>Device status: {devices.length ? "διαθέσιμο" : "άγνωστο"}</span></div>
      <div><small>Επίπεδο ήχου</small><b>{testing ? `${Math.round(level * 100)}%` : "—"}</b><i className="voice-level"><em style={{ width: `${Math.round(level * 100)}%` }} /></i></div>
      <div><small>Θόρυβος περιβάλλοντος</small><b>{noiseLabel[noise]}</b><span>{sampleRate ? `${sampleRate} Hz` : "Sample rate —"}</span></div>
      <div><small>Wake detector</small><b>{wakeStatus}</b>{process.env.NODE_ENV === "development" && <span>Confidence: {wakeAttempts.at(-1) ? `${Math.round(wakeAttempts.at(-1)!.confidence * 100)}%` : "—"}</span>}</div>
      <div><small>Voice session</small><b>Disconnected</b><span>Συνδέεται μόνο στο Κέντρο Ελέγχου</span></div>
    </div>
    <div className="diagnostic-actions"><button type="button" className="secondary" onClick={() => testing ? void stopMeter() : void startMeter()}>{testing ? "Διακοπή δοκιμής" : "Δοκιμή μικροφώνου"}</button><button type="button" className="secondary" onClick={() => void calibrate()}>Βαθμονόμηση μικροφώνου</button><button type="button" className="secondary" onClick={() => void toggleWakeTest()}>{wakeTesting ? "Διακοπή wake test" : "Δοκιμή Hey Jarvis"}</button></div>
    {calibrationStep && <p className="settings-note" role="status">{calibrationStep}</p>}
    {(wakeAttempts.length > 0 || wakeError) && <p className="settings-note" role="status">{wakeError || `${wakeAttempts.length} / 5 detected`}</p>}
    {wakeTesting && <p className="settings-note" role="status">{lastWakeRecognition ? `Τοπική αναγνώριση: «${lastWakeRecognition}»` : "Δεν έχει επιστραφεί ακόμη αναγνωρισμένη φράση από τον browser."}</p>}
    {wakeTesting && <p className="settings-note" role="status">On-device pack: {wakeSignals.pack} · started: {wakeSignals.started} · speech: {wakeSignals.speech} · results: {wakeSignals.result} · no-speech: {wakeSignals.noSpeech} · ended: {wakeSignals.ended}</p>}

    <p className="panel-title personal-subtitle">BRIEFING & ΤΟΠΟΘΕΣΙΑ</p>
    <div className="settings-grid">
      <label className="wide checkbox-label"><input type="checkbox" checked={preferences.automaticBriefing} onChange={(event) => savePreferences({ automaticBriefing: event.target.checked })} /> Αυτόματο briefing</label>
      <label>Briefing level<select value={preferences.briefingLength} onChange={(event) => savePreferences({ briefingLength: event.target.value as "short" | "normal" })}><option value="short">Σύντομο</option><option value="normal">Κανονικό</option></select></label>
      <label>Χειροκίνητη πόλη<input value={preferences.manualCity} onChange={(event) => savePreferences({ manualCity: event.target.value })} placeholder="Λάρισα, Ελλάδα" /></label>
      <label className="checkbox-label"><input type="checkbox" checked={preferences.briefingWeather} onChange={(event) => savePreferences({ briefingWeather: event.target.checked })} /> Καιρός</label>
      <label className="checkbox-label"><input type="checkbox" checked={preferences.briefingCalendar} onChange={(event) => savePreferences({ briefingCalendar: event.target.checked })} /> Ημερολόγιο</label>
      <label className="checkbox-label"><input type="checkbox" checked={preferences.briefingBusiness} onChange={(event) => savePreferences({ briefingBusiness: event.target.checked })} /> Business</label>
      <label className="checkbox-label"><input type="checkbox" checked={preferences.briefingEmail} onChange={(event) => savePreferences({ briefingEmail: event.target.checked })} /> Email</label>
    </div>
    <div className="location-consent"><button type="button" className="secondary" onClick={requestLocation}>Χρήση τρέχουσας τοποθεσίας</button><span>{locationStatus}</span>{locationWeather?.status === "available" && <b>{locationWeather.location} · {Math.round(locationWeather.temperatureC)}°C · {locationWeather.condition}</b>}</div>
    <p className="settings-note">Η ακριβής θέση χρησιμοποιείται μόνο για το τρέχον αίτημα και δεν αποθηκεύεται. Αν η άδεια απορριφθεί, χρησιμοποιείται μόνο η χειροκίνητη πόλη.</p>
  </section>;
}
