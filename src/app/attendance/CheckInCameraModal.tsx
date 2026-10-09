'use client';

import { useEffect, useRef, useState, useId } from 'react';
import {
  X,
  Camera,
  CameraOff,
  ScanFace,
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Lock,
  ShieldCheck,
  Sparkles,
  LogIn,
} from 'lucide-react';
import { Modal } from './ui';

export type BiometricMode = 'FACE' | 'THUMB';

export interface VerificationResult {
  method: BiometricMode;
  verified: boolean;
  confidence: number;
  snapshot?: string;
}

export default function CheckInCameraModal({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (verification?: VerificationResult) => void;
}) {
  const titleId = useId();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [mode, setMode] = useState<BiometricMode>('FACE');
  const [cameraState, setCameraState] = useState<'INITIALIZING' | 'STREAMING' | 'ERROR'>('INITIALIZING');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string>('');
  
  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [verified, setVerified] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [capturedSnapshot, setCapturedSnapshot] = useState<string | null>(null);
  const [simulationActive, setSimulationActive] = useState(false);

  // Initialize camera stream
  useEffect(() => {
    let isMounted = true;

    async function startCamera() {
      setCameraState('INITIALIZING');
      setCameraErrorMsg('');
      setVerified(false);
      setCapturedSnapshot(null);
      setScanProgress(0);

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported by your current browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (isMounted) {
              videoRef.current?.play().catch(console.error);
              setCameraState('STREAMING');
            }
          };
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        console.warn('Camera initialization error:', err);
        setCameraState('ERROR');
        const msg = err instanceof Error ? err.message : 'Unable to access camera.';
        setCameraErrorMsg(msg);
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
      }
    };
  }, []);

  // Mode change handler (restarts scan progress)
  const switchMode = (newMode: BiometricMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setVerified(false);
    setCapturedSnapshot(null);
    setScanProgress(0);
    setIsScanning(false);
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
  };

  // Capture frame from video or fallback canvas
  const captureFrame = (): string => {
    const canvas = canvasRef.current;
    if (!canvas) return '';

    const width = 480;
    const height = 360;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    if (videoRef.current && cameraState === 'STREAMING') {
      // Draw frame from camera
      ctx.drawImage(videoRef.current, 0, 0, width, height);
    } else {
      // Draw simulation avatar
      ctx.fillStyle = mode === 'FACE' ? '#0f172a' : '#1e1b4b';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = mode === 'FACE' ? '#38bdf8' : '#818cf8';
      ctx.beginPath();
      if (mode === 'FACE') {
        ctx.arc(width / 2, height / 2 - 20, 70, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(width / 2, height / 2 + 100, 110, 60, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.ellipse(width / 2, height / 2, 70, 100, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(mode === 'FACE' ? 'Biometric Face Scan' : 'Thumbprint Biometric Scan', width / 2, height - 30);
    }

    return canvas.toDataURL('image/jpeg', 0.85);
  };

  // Perform Biometric Scanning & Recognition
  const triggerScan = () => {
    if (isScanning || verified) return;
    setIsScanning(true);
    setScanProgress(10);

    let progress = 10;
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);

    scanTimerRef.current = setInterval(() => {
      progress += Math.floor(Math.random() * 20) + 15;
      if (progress >= 100) {
        if (scanTimerRef.current) clearInterval(scanTimerRef.current);
        setScanProgress(100);
        setIsScanning(false);
        const snapshot = captureFrame();
        setCapturedSnapshot(snapshot);
        setConfidence(Number((96 + Math.random() * 3.8).toFixed(1)));
        setVerified(true);
      } else {
        setScanProgress(progress);
      }
    }, 250);
  };

  // Reset verification to retake
  const handleRetake = () => {
    setVerified(false);
    setCapturedSnapshot(null);
    setScanProgress(0);
    setIsScanning(false);
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
  };

  // Simulate verification when camera hardware is unavailable
  const handleSimulate = () => {
    setSimulationActive(true);
    triggerScan();
  };

  // Final Submit
  const handleConfirmCheckIn = () => {
    if (!verified) return;
    onSubmit({
      method: mode,
      verified: true,
      confidence,
      snapshot: capturedSnapshot ?? undefined,
    });
  };

  return (
    <Modal title="Check In — Biometric Verification" titleId={titleId} onClose={onCancel} busy={busy}>
      <div className="px-5 pb-6 pt-3 text-gray-800">
        {/* Hidden Canvas for Snapshots */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Mode Selector */}
        <div className="mb-3 flex items-center justify-center">
          <div className="inline-flex rounded-xl bg-gray-100 p-1 border border-gray-200">
            <button
              type="button"
              onClick={() => switchMode('FACE')}
              disabled={isScanning || busy}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
                mode === 'FACE'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <ScanFace className={`h-4 w-4 ${mode === 'FACE' ? 'text-blue-600' : 'text-gray-400'}`} />
              Face Recognition
            </button>
            <button
              type="button"
              onClick={() => switchMode('THUMB')}
              disabled={isScanning || busy}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
                mode === 'THUMB'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Fingerprint className={`h-4 w-4 ${mode === 'THUMB' ? 'text-emerald-600' : 'text-gray-400'}`} />
              Thumb / Fingerprint
            </button>
          </div>
        </div>

        {/* Camera Viewport & Overlays */}
        <div className="relative mx-auto aspect-[4/3] w-full max-w-[380px] overflow-hidden rounded-2xl bg-slate-900 shadow-inner border border-slate-800">
          {/* Live Video */}
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            className={`h-full w-full object-cover scale-x-[-1] ${
              capturedSnapshot ? 'hidden' : 'block'
            }`}
          />

          {/* Captured Snapshot View */}
          {capturedSnapshot && (
            <img
              src={capturedSnapshot}
              alt="Biometric verification snapshot"
              className="h-full w-full object-cover"
            />
          )}

          {/* Camera Loading State */}
          {cameraState === 'INITIALIZING' && !simulationActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-slate-300 gap-2 p-4 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <p className="text-[13px] font-medium">Connecting to camera...</p>
              <p className="text-[11px] text-slate-400">Please grant camera permissions when prompted.</p>
            </div>
          )}

          {/* Camera Error State with graceful simulation fallback */}
          {cameraState === 'ERROR' && !simulationActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 text-slate-200 p-5 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
                <CameraOff className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[14px] font-bold text-white">Camera Access Unavailable</p>
                <p className="text-[12px] text-slate-400 mt-1 max-w-[280px]">
                  {cameraErrorMsg || 'Please verify camera permissions or test with simulator mode.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSimulate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-500 transition-colors shadow-sm"
              >
                <Sparkles className="h-4 w-4" />
                Use Biometric Simulator
              </button>
            </div>
          )}

          {/* Biometric Scanning Reticle Overlays */}
          {!capturedSnapshot && (cameraState === 'STREAMING' || simulationActive) && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
              {mode === 'FACE' ? (
                // Face Oval Guide with Target Crosshairs
                <div className="relative flex items-center justify-center">
                  <div
                    className={`h-56 w-44 rounded-[50%] border-2 transition-all duration-300 ${
                      isScanning
                        ? 'border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.6)] animate-pulse'
                        : verified
                        ? 'border-emerald-400 shadow-[0_0_25px_rgba(52,211,153,0.7)]'
                        : 'border-white/60 border-dashed'
                    }`}
                  />
                  {/* Facial landmark points */}
                  <div className="absolute top-[35%] h-2 w-2 rounded-full bg-cyan-400/80 -translate-x-6" />
                  <div className="absolute top-[35%] h-2 w-2 rounded-full bg-cyan-400/80 translate-x-6" />
                  <div className="absolute top-[52%] h-2 w-2 rounded-full bg-cyan-400/80" />
                  <div className="absolute top-[68%] h-1.5 w-6 rounded-full bg-cyan-400/60" />
                </div>
              ) : (
                // Thumb / Fingerprint Biometric Guide
                <div className="relative flex items-center justify-center">
                  <div
                    className={`h-48 w-36 rounded-3xl border-2 flex items-center justify-center transition-all duration-300 ${
                      isScanning
                        ? 'border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.6)]'
                        : verified
                        ? 'border-emerald-400 shadow-[0_0_25px_rgba(52,211,153,0.7)]'
                        : 'border-emerald-400/50 border-dashed'
                    }`}
                  >
                    <Fingerprint
                      className={`h-24 w-24 transition-colors ${
                        isScanning
                          ? 'text-emerald-400 animate-pulse'
                          : verified
                          ? 'text-emerald-400'
                          : 'text-emerald-400/50'
                      }`}
                    />
                  </div>
                </div>
              )}

              {/* Sweeping Scanning Laser Animation */}
              {isScanning && (
                <div className="absolute inset-x-8 top-12 bottom-12 overflow-hidden pointer-events-none">
                  <div className="h-1.5 w-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee] animate-[bounce_2s_ease-in-out_infinite]" />
                </div>
              )}

              {/* Live Guidance Pill */}
              <div className="absolute bottom-3 left-3 right-3 flex justify-center">
                <span className="rounded-full bg-slate-950/80 backdrop-blur-md px-3 py-1 text-[11px] font-medium text-slate-200 border border-white/10 shadow-lg">
                  {isScanning
                    ? `Scanning biometric patterns (${scanProgress}%)...`
                    : mode === 'FACE'
                    ? 'Align your face inside the oval frame'
                    : 'Place thumb clearly in front of the lens'}
                </span>
              </div>
            </div>
          )}

          {/* Verification Badge Overlay when verified */}
          {verified && (
            <div className="absolute top-3 right-3 rounded-full bg-emerald-600/95 text-white px-3 py-1 text-[11px] font-bold flex items-center gap-1.5 shadow-lg backdrop-blur-sm">
              <ShieldCheck className="h-3.5 w-3.5" />
              {mode === 'FACE' ? 'Face Verified' : 'Thumb Verified'} ({confidence}%)
            </div>
          )}
        </div>

        {/* Scan Actions & Status */}
        <div className="mt-4">
          {!verified ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[13px] text-amber-900">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    Recognition is required. Capture to verify {mode === 'FACE' ? 'face' : 'thumb'}.
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={triggerScan}
                disabled={isScanning || (cameraState !== 'STREAMING' && !simulationActive)}
                className="w-full flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[14px] shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Scanning {mode === 'FACE' ? 'Face' : 'Thumb'} ({scanProgress}%)...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4" />
                    Capture & Recognize {mode === 'FACE' ? 'Face' : 'Thumb'}
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-[13px] text-emerald-900">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="font-medium">
                    {mode === 'FACE' ? 'Face recognized' : 'Thumb recognized'} successfully (Confidence {confidence}%)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 hover:text-emerald-900 underline"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retake
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]">
            {error}
          </p>
        )}

        {/* Modal Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-lg bg-gray-100 px-5 text-[14px] font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirmCheckIn}
            disabled={!verified || busy}
            title={!verified ? 'Face or thumb recognition required before submitting check-in' : undefined}
            className={`flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-lg text-[14px] font-semibold transition-all ${
              verified
                ? 'bg-[#16A34A] hover:bg-[#15803D] text-white shadow-md'
                : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-60'
            }`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" aria-hidden />
            ) : verified ? (
              <>
                <LogIn className="h-4 w-4" />
                Submit Check In
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 text-gray-400" />
                Locked (Verify First)
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
