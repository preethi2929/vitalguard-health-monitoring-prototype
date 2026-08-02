export interface Vitals {
  heartRate: number;
  spo2: number;
  bloodPressure: {
    systolic: number;
    diastolic: number;
  };
  ecg: number[];
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export interface UserProfile {
  name: string;
  age: number;
  bloodGroup: string;
  medicalConditions: string;
  allergies: string;
}

export type AlertStatus = 'normal' | 'warning' | 'critical';

export type ActivityType = 'stationary' | 'walking' | 'jogging' | 'running';

export type DataSource = 'simulated' | 'hardware' | 'manual';

export interface LocationData {
  lat: number;
  lng: number;
  timestamp: number;
  speed: number | null;
  activity: ActivityType;
}

export interface HealthLog {
  timestamp: number;
  vitals: Vitals;
  location: LocationData | null;
  status: AlertStatus;
}

export interface HealthState {
  vitals: Vitals;
  isMoving: boolean;
  fallDetected: boolean;
  distressDetected: boolean;
  lastMotionTimestamp: number;
  activity: ActivityType;
}
