/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  Heart, 
  Wind, 
  AlertTriangle, 
  Settings, 
  Phone, 
  User, 
  Mic, 
  MicOff,
  Bell,
  Navigation,
  ShieldAlert,
  Volume2,
  Clock,
  MapPin,
  History,
  Table,
  Zap,
  Footprints,
  Cpu,
  Edit3,
  Check,
  X,
  Download,
  FileText
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Vitals, EmergencyContact, AlertStatus, ActivityType, LocationData, HealthLog, UserProfile, DataSource } from './types';

// Constants
const FALL_THRESHOLD = 25; // m/s^2 (Impact)
const IMMOBILITY_THRESHOLD = 1.5; // m/s^2 (Standard deviation of acceleration)
const ALERT_TIMEOUT_SECONDS = 300; // 5 minutes as requested
const VOICE_DISTRESS_THRESHOLD = 0.2; // Energy threshold
const PITCH_STRESS_THRESHOLD = 1.2; // Pitch variance threshold

export default function App() {
  // --- State ---
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [activeTab, setActiveTab] = useState<'vitals' | 'safety' | 'location' | 'logs' | 'profile'>('vitals');
  const [dataSource, setDataSource] = useState<DataSource>('simulated');
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualVitals, setManualVitals] = useState({
    hr: '72',
    spo2: '98',
    sys: '120',
    dia: '80'
  });
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [vitals, setVitals] = useState<Vitals>({
    heartRate: 72,
    spo2: 98,
    bloodPressure: { systolic: 120, diastolic: 80 },
    ecg: Array(50).fill(0)
  });
  const [history, setHistory] = useState<any[]>([]);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [locationHistory, setLocationHistory] = useState<LocationData[]>([]);
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [activity, setActivity] = useState<ActivityType>('stationary');
  
  // Fall & Motion State
  const [fallDetected, setFallDetected] = useState(false);
  const [isImmobile, setIsImmobile] = useState(false);
  const [alertCountdown, setAlertCountdown] = useState<number | null>(null);
  const [alertSent, setAlertSent] = useState(false);
  
  // Voice State
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [distressLevel, setDistressLevel] = useState(0); // 0 to 1
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [userPitchRange, setUserPitchRange] = useState({ min: 80, max: 250 }); // Default human range
  
  // Profile & Settings
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('vitalguard_profile');
    return saved ? JSON.parse(saved) : {
      name: "Jane Doe",
      age: 65,
      bloodGroup: "O+",
      medicalConditions: "Hypertension",
      allergies: "Penicillin"
    };
  });

  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact>(() => {
    const saved = localStorage.getItem('vitalguard_contact');
    return saved ? JSON.parse(saved) : {
      name: "John Doe",
      phone: "+1 (555) 012-3456",
      relationship: "Son"
    };
  });

  useEffect(() => {
    localStorage.setItem('vitalguard_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    localStorage.setItem('vitalguard_contact', JSON.stringify(emergencyContact));
  }, [emergencyContact]);
  const [showSettings, setShowSettings] = useState(false);

  // Refs
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastMotionRef = useRef<number>(Date.now());
  const accBufferRef = useRef<number[]>([]);

  // --- Hardware Integration (Web Serial) ---
  const connectToHardware = async () => {
    if (!("serial" in navigator)) {
      alert("Web Serial API is not supported in this browser.");
      return;
    }

    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      setIsSerialConnected(true);
      setDataSource('hardware');

      const reader = port.readable.getReader();
      readerRef.current = reader;

      // Start reading loop
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        // Simple parser for FPGA data (assuming comma-separated values: HR,SPO2,SYS,DIA,ECG)
        // This is a placeholder for actual FPGA protocol
        const text = new TextDecoder().decode(value);
        const lines = text.split('\n');
        
        for (const line of lines) {
          const parts = line.trim().split(',');
          if (parts.length >= 5) {
            const [hr, spo2, sys, dia, ecgVal] = parts.map(Number);
            if (!isNaN(hr)) {
              setVitals(prev => ({
                heartRate: hr || prev.heartRate,
                spo2: spo2 || prev.spo2,
                bloodPressure: {
                  systolic: sys || prev.bloodPressure.systolic,
                  diastolic: dia || prev.bloodPressure.diastolic
                },
                ecg: [...prev.ecg.slice(1), ecgVal || 0]
              }));
            }
          }
        }
      }
    } catch (err: any) {
      console.error("Hardware connection failed:", err);
      if (err.name === 'SecurityError') {
        setHardwareError("Hardware access was denied. Please ensure you've allowed 'Serial' access in your browser settings and that the app has permission.");
      } else if (err.name === 'NotFoundError') {
        // User cancelled the selection
      } else {
        setHardwareError("Hardware connection failed: " + err.message);
      }
      setIsSerialConnected(false);
      setDataSource('simulated');
    }
  };

  const disconnectHardware = async () => {
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current = null;
    }
    if (portRef.current) {
      await portRef.current.close();
      portRef.current = null;
    }
    setIsSerialConnected(false);
    setDataSource('simulated');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hr = parseInt(manualVitals.hr);
    const spo2 = parseFloat(manualVitals.spo2);
    const sys = parseInt(manualVitals.sys);
    const dia = parseInt(manualVitals.dia);

    if (!isNaN(hr) && !isNaN(spo2) && !isNaN(sys) && !isNaN(dia)) {
      setVitals(prev => ({
        ...prev,
        heartRate: hr,
        spo2: spo2,
        bloodPressure: { systolic: sys, diastolic: dia }
      }));
      
      setHistory(h => [...h.slice(-29), {
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        hr: hr,
        bp: sys
      }]);

      setShowManualInput(false);
      setDataSource('manual');
    }
  };

  // --- Geolocation & Activity ---
  const updateLocation = useCallback(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const speed = pos.coords.speed; // m/s
        let currentActivity: ActivityType = 'stationary';
        
        if (speed !== null) {
          if (speed > 4) currentActivity = 'running';
          else if (speed > 2) currentActivity = 'jogging';
          else if (speed > 0.5) currentActivity = 'walking';
        } else if (isMonitoring) {
          // Fallback simulation if speed is null
          const random = Math.random();
          if (random > 0.9) currentActivity = 'jogging';
          else if (random > 0.7) currentActivity = 'walking';
        }

        const newLoc: LocationData = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: Date.now(),
          speed: speed,
          activity: currentActivity
        };

        setLocation(newLoc);
        setActivity(currentActivity);
        if (isMonitoring) {
          setLocationHistory(prev => [...prev.slice(-50), newLoc]);
        }
      });
    }
  }, [isMonitoring]);

  useEffect(() => {
    const locInterval = setInterval(updateLocation, 5000);
    return () => clearInterval(locInterval);
  }, [updateLocation]);

  // --- Logging Logic (Simulated Hourly) ---
  const vitalsRef = useRef(vitals);
  const locationRef = useRef(location);
  
  useEffect(() => {
    vitalsRef.current = vitals;
  }, [vitals]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    if (!isMonitoring) return;

    // For demo purposes, we log every 30 seconds instead of 1 hour
    const logInterval = setInterval(() => {
      const newLog: HealthLog = {
        timestamp: Date.now(),
        vitals: { ...vitalsRef.current },
        location: locationRef.current ? { ...locationRef.current } : null,
        status: getGlobalStatus()
      };
      setLogs(prev => [newLog, ...prev.slice(0, 99)]);
    }, 30000);

    return () => clearInterval(logInterval);
  }, [isMonitoring]);

  // --- ECG Simulation ---
  useEffect(() => {
    if (!isMonitoring || dataSource !== 'simulated') return;

    let phase = 0;
    const ecgInterval = setInterval(() => {
      setVitals(prev => {
        // Simple ECG waveform simulation (P-QRS-T)
        // This is a very simplified model for visualization
        const hr = prev.heartRate;
        const bps = hr / 60; // beats per second
        const period = 1 / bps; // seconds per beat
        const t = phase % period;
        
        let val = 0;
        // P wave
        if (t > 0 && t < 0.1) val = Math.sin((t / 0.1) * Math.PI) * 0.1;
        // QRS complex
        else if (t > 0.12 && t < 0.15) val = -0.1;
        else if (t > 0.15 && t < 0.18) val = 1.0;
        else if (t > 0.18 && t < 0.21) val = -0.2;
        // T wave
        else if (t > 0.35 && t < 0.5) val = Math.sin(((t - 0.35) / 0.15) * Math.PI) * 0.2;
        
        // Add some noise
        val += (Math.random() - 0.5) * 0.05;

        const newEcg = [...prev.ecg.slice(1), val];
        phase += 0.05; // 50ms step

        return { ...prev, ecg: newEcg };
      });
    }, 50);

    return () => clearInterval(ecgInterval);
  }, [isMonitoring]);

  // --- Vitals Simulation ---
  useEffect(() => {
    if (!isMonitoring || dataSource !== 'simulated') return;

    const interval = setInterval(() => {
      setVitals(prev => {
        const next = {
          ...prev,
          heartRate: Math.floor(prev.heartRate + (Math.random() * 4 - 2)),
          spo2: Math.min(100, Math.max(90, prev.spo2 + (Math.random() * 0.4 - 0.2))),
          bloodPressure: {
            systolic: Math.floor(prev.bloodPressure.systolic + (Math.random() * 2 - 1)),
            diastolic: Math.floor(prev.bloodPressure.diastolic + (Math.random() * 2 - 1))
          }
        };

        setHistory(h => [...h.slice(-29), {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          hr: next.heartRate,
          bp: next.bloodPressure.systolic
        }]);

        return next;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isMonitoring]);

  // --- Fall Detection Logic ---
  useEffect(() => {
    if (!isMonitoring) return;

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;

      const magnitude = Math.sqrt((acc.x || 0)**2 + (acc.y || 0)**2 + (acc.z || 0)**2);
      
      // Impact detection
      if (magnitude > FALL_THRESHOLD && !fallDetected) {
        setFallDetected(true);
        setAlertCountdown(ALERT_TIMEOUT_SECONDS);
      }

      // Immobility detection (using a rolling buffer of acceleration variance)
      accBufferRef.current.push(magnitude);
      if (accBufferRef.current.length > 50) accBufferRef.current.shift();

      const mean = accBufferRef.current.reduce((a, b) => a + b, 0) / accBufferRef.current.length;
      const variance = accBufferRef.current.reduce((a, b) => a + (b - mean)**2, 0) / accBufferRef.current.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev < IMMOBILITY_THRESHOLD) {
        setIsImmobile(true);
      } else {
        setIsImmobile(false);
        // If they move significantly, cancel the fall alert (false alarm mitigation)
        if (fallDetected && stdDev > 5) {
          setFallDetected(false);
          setAlertCountdown(null);
        }
      }
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [isMonitoring, fallDetected]);

  // --- Alert Countdown ---
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (fallDetected && isImmobile && alertCountdown !== null && alertCountdown > 0) {
      timer = setInterval(() => {
        setAlertCountdown(c => (c !== null ? c - 1 : null));
      }, 1000);
    } else if (alertCountdown === 0 && !alertSent) {
      sendEmergencyAlert();
    }

    return () => clearInterval(timer);
  }, [fallDetected, isImmobile, alertCountdown, alertSent]);

  const sendEmergencyAlert = () => {
    setAlertSent(true);
    updateLocation();
    // Simulation of sending alert
    console.log(`EMERGENCY ALERT SENT to ${emergencyContact.name} (${emergencyContact.phone})`);
    console.log(`Location: ${location?.lat}, ${location?.lng}`);
  };

  // --- Voice Analysis (Privacy Focused) ---
  const startVoiceAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      setVoiceEnabled(true);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const freqArray = new Uint8Array(bufferLength);

      const analyze = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        analyserRef.current.getByteFrequencyData(freqArray);

        // 1. Calculate Energy (Volume)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const energy = Math.sqrt(sum / bufferLength);

        // 2. Simple Pitch Detection (Fundamental Frequency)
        // We look for the peak in the frequency domain within human speech range
        let maxVal = -1;
        let maxIndex = -1;
        const sampleRate = ctx.sampleRate;
        const nyquist = sampleRate / 2;
        
        // Human speech is typically 80Hz to 1000Hz for fundamental
        const minIdx = Math.floor((80 / nyquist) * bufferLength);
        const maxIdx = Math.floor((1000 / nyquist) * bufferLength);

        for (let i = minIdx; i < maxIdx; i++) {
          if (freqArray[i] > maxVal) {
            maxVal = freqArray[i];
            maxIndex = i;
          }
        }

        const pitch = (maxIndex * nyquist) / bufferLength;

        // 3. User Voice Filtering & Distress Detection
        // We only consider it "user speaking" if energy is high and pitch is in their range
        const isSpeaking = energy > 0.05 && pitch >= userPitchRange.min && pitch <= userPitchRange.max;
        setIsUserSpeaking(isSpeaking);

        if (isSpeaking) {
          // Distress metrics: High volume spikes or high pitch variance
          // This is a simplified model for demo
          let distress = 0;
          if (energy > VOICE_DISTRESS_THRESHOLD) distress += 0.5;
          if (pitch > userPitchRange.max * 0.9) distress += 0.5; // High pitch often correlates with stress
          
          setDistressLevel(prev => Math.min(1, prev * 0.95 + distress * 0.05));
        } else {
          setDistressLevel(prev => prev * 0.98); // Decay
        }

        animationFrameRef.current = requestAnimationFrame(analyze);
      };

      analyze();
    } catch (err) {
      console.error("Mic access denied", err);
    }
  };

  const stopVoiceAnalysis = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    setVoiceEnabled(false);
    setIsUserSpeaking(false);
    setDistressLevel(0);
  };

  // --- UI Helpers ---
  const getGlobalStatus = (): AlertStatus => {
    if (alertSent || (fallDetected && isImmobile && alertCountdown === 0)) return 'critical';
    
    // Check Vitals for Critical
    if (vitals.heartRate < 40 || vitals.heartRate > 140) return 'critical';
    if (vitals.spo2 < 90) return 'critical';
    if (vitals.bloodPressure.systolic > 180 || vitals.bloodPressure.diastolic > 110) return 'critical';

    // Check Vitals for Warning
    if (fallDetected || distressLevel > 0.7) return 'warning';
    if (vitals.heartRate < 60 || vitals.heartRate > 100) return 'warning';
    if (vitals.spo2 < 95) return 'warning';
    if (vitals.bloodPressure.systolic > 140 || vitals.bloodPressure.diastolic > 90) return 'warning';

    return 'normal';
  };

  const exportLogsToCSV = () => {
    if (logs.length === 0) return;

    const headers = ["Timestamp", "Heart Rate", "SpO2", "Systolic BP", "Diastolic BP", "Latitude", "Longitude", "Activity", "Status"];
    const rows = logs.map(log => [
      new Date(log.timestamp).toISOString(),
      log.vitals.heartRate,
      log.vitals.spo2,
      log.vitals.bloodPressure.systolic,
      log.vitals.bloodPressure.diastolic,
      log.location?.lat || "",
      log.location?.lng || "",
      log.location?.activity || "N/A",
      log.status
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `vitalguard_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const status = getGlobalStatus();

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-[#1C1E21] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <ShieldAlert size={24} />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight">VitalGuard Pro</h1>
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", isMonitoring ? "bg-green-500 animate-pulse" : "bg-gray-300")} />
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">
                {isMonitoring ? "Live Monitoring" : "System Standby"}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex bg-gray-100 p-1 rounded-2xl">
          <TabButton active={activeTab === 'vitals'} onClick={() => setActiveTab('vitals')} icon={<Heart size={16} />} label="Vitals" />
          <TabButton active={activeTab === 'safety'} onClick={() => setActiveTab('safety')} icon={<AlertTriangle size={16} />} label="Safety" />
          <TabButton active={activeTab === 'location'} onClick={() => setActiveTab('location')} icon={<Navigation size={16} />} label="Location" />
          <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={<Table size={16} />} label="Logs" />
          <TabButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<User size={16} />} label="Profile" />
        </nav>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsMonitoring(!isMonitoring)}
            className={cn(
              "px-6 py-2.5 rounded-full text-sm font-bold transition-all transform active:scale-95 shadow-md",
              isMonitoring 
                ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200" 
                : "bg-blue-600 text-white hover:bg-blue-700"
            )}
          >
            {isMonitoring ? "Stop System" : "Activate System"}
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2.5 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {/* Emergency Alert Banner (Always visible if active) */}
        <AnimatePresence>
          {status !== 'normal' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "p-6 rounded-[2rem] border-2 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl mb-6",
                status === 'critical' ? "bg-red-50 border-red-200 text-red-900" : "bg-amber-50 border-amber-200 text-amber-900"
              )}
            >
              <div className="flex items-center gap-5">
                <div className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center shadow-inner",
                  status === 'critical' ? "bg-red-200 text-red-600" : "bg-amber-200 text-amber-600"
                )}>
                  <AlertTriangle size={32} className={status === 'critical' ? "animate-bounce" : ""} />
                </div>
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight">
                    {status === 'critical' ? "Emergency Alert Active" : "Potential Distress Detected"}
                  </h2>
                  <p className="text-sm font-medium opacity-80">
                    {status === 'critical' 
                      ? `Fall detected & immobility confirmed. Emergency services and ${emergencyContact.name} notified.` 
                      : "Vocal patterns or motion spikes indicate potential distress. Monitoring closely."}
                  </p>
                  {alertCountdown !== null && alertCountdown > 0 && !alertSent && (
                    <div className="mt-2 flex items-center gap-2 font-bold text-red-600">
                      <Clock size={16} />
                      <span>Alert in {Math.floor(alertCountdown / 60)}:{(alertCountdown % 60).toString().padStart(2, '0')}</span>
                    </div>
                  )}
                </div>
              </div>
              <button 
                onClick={() => {
                  setFallDetected(false);
                  setAlertSent(false);
                  setAlertCountdown(null);
                  setIsImmobile(false);
                }}
                className="bg-white text-gray-900 px-8 py-3 rounded-2xl font-bold shadow-lg hover:bg-gray-50 transition-all transform active:scale-95 whitespace-nowrap"
              >
                I'm Safe
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {activeTab === 'vitals' && (
            <motion.div 
              key="vitals"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="bg-white p-6 rounded-[2rem] border border-gray-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner",
                    status === 'normal' ? "bg-green-100 text-green-600" : 
                    status === 'warning' ? "bg-amber-100 text-amber-600" :
                    "bg-red-100 text-red-600"
                  )}>
                    <Bell size={24} className={cn(status !== 'normal' && "animate-bounce")} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">System Status</h3>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                        status === 'normal' ? "bg-green-500 text-white" : 
                        status === 'warning' ? "bg-amber-500 text-white" :
                        "bg-red-500 text-white"
                      )}>
                        {status}
                      </span>
                      <p className="text-xs text-gray-400 font-medium">
                        {status === 'normal' ? "All systems operational" : 
                         status === 'warning' ? "Attention required" :
                         "Critical health alert active"}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-right hidden md:block">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Last Update</p>
                    <p className="text-sm font-bold">{new Date().toLocaleTimeString()}</p>
                  </div>
                  <div className="w-px h-8 bg-gray-100 hidden md:block" />
                  <div className="flex items-center gap-2">
                    <div className={cn("w-3 h-3 rounded-full", isMonitoring ? "bg-green-500 animate-pulse" : "bg-gray-300")} />
                    <span className="text-xs font-bold text-gray-600">
                      {isMonitoring ? "Live" : "Paused"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Data Source Selector */}
              <div className="bg-white p-6 rounded-[2rem] border border-gray-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner",
                    dataSource === 'hardware' ? "bg-purple-100 text-purple-600" : 
                    dataSource === 'manual' ? "bg-amber-100 text-amber-600" :
                    "bg-blue-100 text-blue-600"
                  )}>
                    {dataSource === 'hardware' ? <Cpu size={24} /> : 
                     dataSource === 'manual' ? <Edit3 size={24} /> :
                     <Zap size={24} />}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Data Source</h3>
                    <p className="text-xs text-gray-400 font-medium">
                      {dataSource === 'hardware' ? "Connected to FPGA Hardware" : 
                       dataSource === 'manual' ? "Manual Data Entry Mode" :
                       "Running in Simulation Mode"}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-2xl">
                  <button 
                    onClick={() => {
                      if (isSerialConnected) disconnectHardware();
                      setDataSource('simulated');
                      setHardwareError(null);
                    }}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                      dataSource === 'simulated' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Simulated
                  </button>
                  <button 
                    onClick={() => {
                      if (isSerialConnected) disconnectHardware();
                      setShowManualInput(true);
                      setHardwareError(null);
                    }}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                      dataSource === 'manual' ? "bg-white text-amber-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Manual
                  </button>
                  <button 
                    onClick={() => {
                      if (!isSerialConnected) connectToHardware();
                      else setDataSource('hardware');
                    }}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
                      dataSource === 'hardware' ? "bg-white text-purple-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Hardware (FPGA)
                    {isSerialConnected && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                  </button>
                </div>
              </div>

              {/* Hardware Error Message */}
              <AnimatePresence>
                {hardwareError && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 text-red-600">
                      <AlertTriangle size={18} />
                      <p className="text-xs font-bold">{hardwareError}</p>
                    </div>
                    <button 
                      onClick={() => setHardwareError(null)}
                      className="text-red-400 hover:text-red-600 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Manual Input Modal */}
              <AnimatePresence>
                {showManualInput && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="bg-white rounded-[2.5rem] p-8 w-full max-w-md shadow-2xl border border-gray-100"
                    >
                      <div className="flex items-center justify-between mb-8">
                        <div>
                          <h2 className="text-2xl font-black tracking-tight">Manual Entry</h2>
                          <p className="text-sm text-gray-400 font-medium">Update vitals manually</p>
                        </div>
                        <button 
                          onClick={() => setShowManualInput(false)}
                          className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <form onSubmit={handleManualSubmit} className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">Heart Rate (BPM)</label>
                            <input 
                              type="number" 
                              value={manualVitals.hr}
                              onChange={(e) => setManualVitals(prev => ({ ...prev, hr: e.target.value }))}
                              className="w-full bg-gray-50 border-none rounded-2xl p-4 font-bold text-lg focus:ring-2 focus:ring-amber-500 transition-all"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">SpO2 (%)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={manualVitals.spo2}
                              onChange={(e) => setManualVitals(prev => ({ ...prev, spo2: e.target.value }))}
                              className="w-full bg-gray-50 border-none rounded-2xl p-4 font-bold text-lg focus:ring-2 focus:ring-amber-500 transition-all"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">Systolic (mmHg)</label>
                            <input 
                              type="number" 
                              value={manualVitals.sys}
                              onChange={(e) => setManualVitals(prev => ({ ...prev, sys: e.target.value }))}
                              className="w-full bg-gray-50 border-none rounded-2xl p-4 font-bold text-lg focus:ring-2 focus:ring-amber-500 transition-all"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">Diastolic (mmHg)</label>
                            <input 
                              type="number" 
                              value={manualVitals.dia}
                              onChange={(e) => setManualVitals(prev => ({ ...prev, dia: e.target.value }))}
                              className="w-full bg-gray-50 border-none rounded-2xl p-4 font-bold text-lg focus:ring-2 focus:ring-amber-500 transition-all"
                              required
                            />
                          </div>
                        </div>

                        <button 
                          type="submit"
                          className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-amber-200 transition-all flex items-center justify-center gap-2"
                        >
                          <Check size={20} />
                          Apply Readings
                        </button>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <VitalCard 
                  title="Heart Rate" 
                  value={vitals.heartRate} 
                  unit="BPM" 
                  icon={<Heart className="text-red-500" />}
                  trend={history.length > 1 ? vitals.heartRate - history[history.length-2].hr : 0}
                />
                <VitalCard 
                  title="Blood Oxygen" 
                  value={vitals.spo2.toFixed(1)} 
                  unit="%" 
                  icon={<Wind className="text-blue-500" />}
                  status={vitals.spo2 < 95 ? 'warning' : 'normal'}
                />
                <VitalCard 
                  title="Blood Pressure" 
                  value={`${vitals.bloodPressure.systolic}/${vitals.bloodPressure.diastolic}`} 
                  unit="mmHg" 
                  icon={<Activity className="text-emerald-500" />}
                />
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-lg font-bold">Electrocardiogram (ECG)</h3>
                    <p className="text-xs text-gray-400 font-medium">Real-time cardiac waveform</p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full">
                    <Activity size={12} className="animate-pulse" />
                    LIVE
                  </div>
                </div>
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={vitals.ecg.map((val, i) => ({ i, val }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis dataKey="i" hide />
                      <YAxis hide domain={[-0.5, 1.2]} />
                      <Line 
                        type="monotone" 
                        dataKey="val" 
                        stroke="#EF4444" 
                        strokeWidth={2} 
                        dot={false} 
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-lg font-bold">Real-time Analytics</h3>
                    <p className="text-xs text-gray-400 font-medium">Continuous health telemetry</p>
                  </div>
                </div>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis dataKey="time" hide />
                      <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                        itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                      />
                      <Area type="monotone" dataKey="hr" stroke="#3B82F6" strokeWidth={4} fillOpacity={1} fill="url(#colorHr)" />
                      <Area type="monotone" dataKey="bp" stroke="#10B981" strokeWidth={4} fillOpacity={0} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'safety' && (
            <motion.div 
              key="safety"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Voice Analysis</h3>
                  <button 
                    onClick={voiceEnabled ? stopVoiceAnalysis : startVoiceAnalysis}
                    className={cn(
                      "p-3 rounded-2xl transition-all shadow-md",
                      voiceEnabled ? "bg-red-50 text-red-600" : "bg-blue-600 text-white"
                    )}
                  >
                    {voiceEnabled ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-gray-50 border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                        isUserSpeaking ? "bg-blue-100 text-blue-600" : "bg-gray-200 text-gray-400"
                      )}>
                        <Volume2 size={20} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Input Status</p>
                        <p className="font-bold text-sm">{isUserSpeaking ? "User Speaking" : "Ambient Noise"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase">
                      <span>Distress Indicator</span>
                      <span>{Math.round(distressLevel * 100)}%</span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div 
                        animate={{ width: `${distressLevel * 100}%` }}
                        className={cn(
                          "h-full rounded-full transition-colors",
                          distressLevel > 0.7 ? "bg-red-500" : distressLevel > 0.4 ? "bg-amber-500" : "bg-blue-500"
                        )}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm space-y-6">
                <h3 className="text-lg font-bold">Motion Safety</h3>
                <div className="space-y-4">
                  <StatusRow 
                    label="Motion State" 
                    value={isImmobile ? "Immobile" : "Active"} 
                    active={!isImmobile}
                    icon={<Activity size={18} />}
                  />
                  <StatusRow 
                    label="Impact Sensor" 
                    value={fallDetected ? "Impact Detected" : "Normal"} 
                    active={!fallDetected}
                    icon={<Bell size={18} />}
                    alert={fallDetected}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'location' && (
            <motion.div 
              key="location"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              <div className="md:col-span-1 space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm space-y-6">
                  <h3 className="text-lg font-bold">Current Activity</h3>
                  <div className="flex flex-col items-center justify-center p-8 rounded-3xl bg-blue-50 border border-blue-100">
                    <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center text-blue-600 shadow-xl mb-4">
                      {activity === 'jogging' || activity === 'running' ? <Zap size={40} className="animate-pulse" /> : <Footprints size={40} />}
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</p>
                    <p className="text-2xl font-black uppercase text-blue-900">{activity}</p>
                    {activity === 'jogging' && (
                      <div className="mt-4 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-full animate-bounce">
                        Jogging Detected
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-bold mb-4">Location Teller</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-gray-50">
                      <MapPin className="text-blue-500" size={20} />
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Latitude</p>
                        <p className="font-bold">{location?.lat.toFixed(6) || '---'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-gray-50">
                      <MapPin className="text-blue-500" size={20} />
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Longitude</p>
                        <p className="font-bold">{location?.lng.toFixed(6) || '---'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm">
                <h3 className="text-lg font-bold mb-6">Movement History</h3>
                <div className="h-[400px] w-full bg-gray-50 rounded-3xl relative overflow-hidden flex items-center justify-center border border-dashed border-gray-300">
                  {/* Simulated Map / Path View */}
                  <div className="absolute inset-0 p-8">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={locationHistory}>
                        <Line type="monotone" dataKey="lat" stroke="#3B82F6" strokeWidth={4} dot={false} />
                        <Line type="monotone" dataKey="lng" stroke="#10B981" strokeWidth={4} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="relative z-10 text-center">
                    <Navigation className="mx-auto text-gray-300 mb-2" size={48} />
                    <p className="text-sm text-gray-400 font-medium">Live Path Tracking Active</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-white rounded-[2.5rem] border border-gray-200 shadow-sm overflow-hidden"
            >
              <div className="p-8 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">Hourly Health Logs</h3>
                  <p className="text-xs text-gray-400 font-medium">System-wide data archival</p>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={exportLogsToCSV}
                    disabled={logs.length === 0}
                    className="flex items-center gap-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download size={14} />
                    Export CSV
                  </button>
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-600 bg-blue-50 px-4 py-2 rounded-full">
                    <History size={14} />
                    {logs.length} Entries
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                      <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        <th className="px-8 py-4">Time</th>
                        <th className="px-8 py-4">Vitals (HR/BP/ECG)</th>
                        <th className="px-8 py-4">Location</th>
                        <th className="px-8 py-4">Activity</th>
                        <th className="px-8 py-4">Status</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-8 py-12 text-center text-gray-400 font-medium">
                          No logs recorded yet. Monitoring must be active.
                        </td>
                      </tr>
                    ) : (
                      logs.map((log, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-8 py-4 font-bold text-sm">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="px-8 py-4">
                            <div className="flex items-center gap-4">
                              <span className="flex items-center gap-1 text-red-600 font-bold">
                                <Heart size={12} /> {log.vitals.heartRate}
                              </span>
                              <span className="flex items-center gap-1 text-emerald-600 font-bold">
                                <Activity size={12} /> {log.vitals.bloodPressure.systolic}/{log.vitals.bloodPressure.diastolic}
                              </span>
                              <span className="flex items-center gap-1 text-red-400 font-bold">
                                <Zap size={12} /> ECG Active
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-4 text-xs font-medium text-gray-500">
                            {log.location ? `${log.location.lat.toFixed(4)}, ${log.location.lng.toFixed(4)}` : 'N/A'}
                          </td>
                          <td className="px-8 py-4">
                            <span className="text-[10px] font-bold uppercase px-2 py-1 bg-blue-50 text-blue-600 rounded-md">
                              {log.location?.activity || 'N/A'}
                            </span>
                          </td>
                          <td className="px-8 py-4">
                            <div className={cn(
                              "w-3 h-3 rounded-full",
                              log.status === 'normal' ? "bg-green-500" : log.status === 'warning' ? "bg-amber-500" : "bg-red-500"
                            )} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-black tracking-tight">Personal Information</h3>
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                      <User size={24} />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <ProfileField 
                      label="Full Name" 
                      value={userProfile.name} 
                      onChange={(val) => setUserProfile(p => ({ ...p, name: val }))} 
                    />
                    <ProfileField 
                      label="Age" 
                      value={userProfile.age.toString()} 
                      onChange={(val) => setUserProfile(p => ({ ...p, age: parseInt(val) || 0 }))} 
                      type="number"
                    />
                    <ProfileField 
                      label="Blood Group" 
                      value={userProfile.bloodGroup} 
                      onChange={(val) => setUserProfile(p => ({ ...p, bloodGroup: val }))} 
                    />
                    <ProfileField 
                      label="Allergies" 
                      value={userProfile.allergies} 
                      onChange={(val) => setUserProfile(p => ({ ...p, allergies: val }))} 
                    />
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Medical Conditions</label>
                      <textarea 
                        value={userProfile.medicalConditions}
                        onChange={(e) => setUserProfile(p => ({ ...p, medicalConditions: e.target.value }))}
                        className="w-full px-6 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold min-h-[100px]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black tracking-tight">Emergency Contact</h3>
                    <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-600">
                      <Phone size={24} />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <ProfileField 
                      label="Contact Name" 
                      value={emergencyContact.name} 
                      onChange={(val) => setEmergencyContact(p => ({ ...p, name: val }))} 
                    />
                    <ProfileField 
                      label="Phone Number" 
                      value={emergencyContact.phone} 
                      onChange={(val) => setEmergencyContact(p => ({ ...p, phone: val }))} 
                    />
                    <ProfileField 
                      label="Relationship" 
                      value={emergencyContact.relationship} 
                      onChange={(val) => setEmergencyContact(p => ({ ...p, relationship: val }))} 
                    />
                  </div>

                  <div className="p-6 rounded-3xl bg-red-50 border border-red-100">
                    <div className="flex items-center gap-3 text-red-600 mb-2">
                      <AlertTriangle size={18} />
                      <span className="text-xs font-bold uppercase">Safety Protocol</span>
                    </div>
                    <p className="text-[10px] text-red-900/60 font-medium leading-relaxed">
                      This contact will be automatically notified via SMS and voice call if an emergency event (fall or distress) is confirmed by the system.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[3rem] p-10 shadow-2xl"
            >
              <h2 className="text-3xl font-black mb-8 tracking-tight">System Configuration</h2>
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Contact Name</label>
                    <input 
                      type="text" 
                      value={emergencyContact.name}
                      onChange={(e) => setEmergencyContact(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-6 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Contact Phone</label>
                    <input 
                      type="text" 
                      value={emergencyContact.phone}
                      onChange={(e) => setEmergencyContact(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-6 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Relationship</label>
                    <input 
                      type="text" 
                      value={emergencyContact.relationship}
                      onChange={(e) => setEmergencyContact(prev => ({ ...prev, relationship: e.target.value }))}
                      className="w-full px-6 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Voice Profile Calibration</label>
                  <div className="p-6 rounded-3xl bg-blue-50 border border-blue-100 space-y-4">
                    <div className="flex justify-between text-xs font-bold text-blue-800">
                      <span>Pitch Range (Hz)</span>
                      <span>{userPitchRange.min} - {userPitchRange.max}</span>
                    </div>
                    <div className="flex gap-4">
                      <input 
                        type="range" min="50" max="500" value={userPitchRange.min}
                        onChange={(e) => setUserPitchRange(p => ({ ...p, min: parseInt(e.target.value) }))}
                        className="flex-1 accent-blue-600"
                      />
                      <input 
                        type="range" min="50" max="500" value={userPitchRange.max}
                        onChange={(e) => setUserPitchRange(p => ({ ...p, max: parseInt(e.target.value) }))}
                        className="flex-1 accent-blue-600"
                      />
                    </div>
                    <p className="text-[10px] text-blue-600 opacity-80">Adjust these sliders while speaking to calibrate the system to your unique voice frequency.</p>
                  </div>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full bg-gray-900 text-white py-5 rounded-2xl font-bold text-lg shadow-xl hover:bg-black transition-all transform active:scale-[0.98]"
                >
                  Apply Configuration
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
        active ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
      )}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function VitalCard({ title, value, unit, icon, trend, status = 'normal' }: { 
  title: string, value: string | number, unit: string, icon: React.ReactNode, trend?: number, status?: AlertStatus 
}) {
  return (
    <div className={cn(
      "bg-white p-6 rounded-[2rem] border transition-all duration-300",
      status === 'warning' ? "border-amber-200 bg-amber-50/30" : "border-gray-100 shadow-sm"
    )}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{title}</span>
        <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center shadow-inner">
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-black tracking-tight">{value}</span>
        <span className="text-xs font-bold text-gray-400">{unit}</span>
      </div>
      {trend !== undefined && (
        <div className="mt-3 flex items-center gap-1">
          <div className={cn(
            "text-[10px] font-bold px-2 py-0.5 rounded-full",
            trend > 0 ? "bg-red-50 text-red-600" : trend < 0 ? "bg-green-50 text-green-600" : "bg-gray-50 text-gray-400"
          )}>
            {trend > 0 ? "+" : ""}{trend} {unit}
          </div>
          <span className="text-[10px] text-gray-400 font-medium">vs last check</span>
        </div>
      )}
    </div>
  );
}

function StatusRow({ label, value, active, icon, alert }: { label: string, value: string, active: boolean, icon: React.ReactNode, alert?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between p-4 rounded-2xl border transition-all",
      alert ? "bg-red-50 border-red-100 text-red-900" : "bg-gray-50 border-gray-100"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm",
          active ? "bg-white text-blue-600" : "bg-white text-gray-400",
          alert && "bg-red-200 text-red-600"
        )}>
          {icon}
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
          <p className="font-bold text-sm">{value}</p>
        </div>
      </div>
      {active && <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />}
    </div>
  );
}

function ProfileField({ label, value, onChange, type = "text" }: { label: string, value: string, onChange: (val: string) => void, type?: string }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">{label}</label>
      <input 
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-6 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
      />
    </div>
  );
}
