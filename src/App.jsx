import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { rawGpsSpeed, rawGpsMotion } from './gpsMotion';
import {
  Activity,
  ArrowRight,
  Battery,
  Bell,
  BusFront,
  Camera,
  ChevronDown,
  Droplets,
  FileClock,
  Fuel,
  Gauge,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Monitor,
  Navigation,
  RefreshCcw,
  Route,
  Settings,
  ShieldCheck,
  Thermometer,
  TriangleAlert,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { signOutActiveUser, supabase } from './supabase';
import { BACKEND_CONFIG } from './config/backendConfig';
import { archiveBus, registerBus, updateBusPlateNumber } from './services/busManagement';
import LoadablePanel from './LoadablePanel';
import { recordGpsLatency } from './gpsLatency';
import DeviceSetup from './settings/DeviceSetup';
import { createWifiStatusService } from './settings/wifiStatusService';
import { createRemoteWifiService } from './settings/remoteWifiService';
import { createDevicePresenceService } from './settings/devicePresenceService';
import CameraGaugePanel from './camera/CameraGaugePanel';
import LiveCameraView from './camera/LiveCameraView';
import { createCameraFrameService } from './camera/cameraFrameService';
import CameraFrameGaugePanel from './camera/CameraFrameGaugePanel';
import { cameraReadingsFeatureEnabled } from './camera/cameraReadings';
import { AnimatedCameraGauge } from './camera/LiveCameraGauges';
import { LIVE_GAUGE_PLACEHOLDERS } from './camera/liveCameraGaugeModel';
import './VehicleConditionPage.css';
import ConditionHistoryExport from './camera/ConditionHistoryExport';
import { createConditionHistoryService } from './camera/conditionHistoryCsv';

const ROUTE_DEVIATION_DEFAULT_M = 100;
const SYSTEM_HEALTH_THRESHOLDS = {
  gpsLiveMs: 30_000,
  gpsStaleMs: 60_000,
  deviceOnlineMs: 10_000,
  deviceDelayedMs: 20_000,
  backendOfflineMs: 15_000,
  backendPollMs: 5_000,
  backendFailureLimit: 2,
};
const WIFI_STATUS_SERVICE = createWifiStatusService({
  config: BACKEND_CONFIG,
  getSession: () => supabase.auth.getSession(),
});
const DEVICE_PRESENCE_SERVICE = createDevicePresenceService({ config: BACKEND_CONFIG, getSession: () => supabase.auth.getSession() });
const REMOTE_WIFI_SERVICE = createRemoteWifiService({ config: BACKEND_CONFIG, getSession: () => supabase.auth.getSession() });
const CAMERA_FRAME_SERVICE = createCameraFrameService({ config: BACKEND_CONFIG, getSession: () => supabase.auth.getSession(),
  enabled: process.env.VITE_CAMERA_FRAMES_ENABLED === 'true' && (process.env.NODE_ENV !== 'production' || BACKEND_CONFIG.cloudCameraEnabled) });
const CONDITION_HISTORY_SERVICE = createConditionHistoryService({ config: BACKEND_CONFIG, getSession: () => supabase.auth.getSession() });
const CENTRABUS_LOCKED_LOGO_SRC = '/centrabus-locked-logo.png';
const loadGpsHistoryExplorer = () => import('./records/GpsHistoryExplorer');
const NOTIFICATION_PREFERENCES_KEY = 'centrabus.notificationPreferences';
const DEFAULT_NOTIFICATION_PREFERENCES = {
  gaugePanel: true,
  routeDeviation: true,
  system: true,
  sound: true,
};
const roadRouteCache = {};

export function normalizeNotificationPreferences(saved) {
  return Object.fromEntries(Object.entries(DEFAULT_NOTIFICATION_PREFERENCES).map(([key, fallback]) =>
    [key, typeof saved?.[key] === 'boolean' ? saved[key] : fallback]));
}

// Compatibility boundary for retired events, NOT deletion of stored history.
// Match explicit TPMS/tire identifiers; gauge air-pressure alerts stay supported.
export function isRetiredTirePressureAlert(alert) {
  return ['id', 'issueKey', 'type', 'eventType', 'sensorType', 'category', 'title'].some((key) => {
    const text = String(alert?.[key] || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    return /\btpms\b|\b(?:tire|tyre)\s*(?:pressure|sensor|status)\b/.test(text)
      || ((key === 'id' || key === 'issueKey') && /^(?:condition )?(?:tire|tyre)\b/.test(text));
  });
}

/* ─── Gauge Panel Configuration ──────────────────── */
const GAUGE_PARAMETERS = [
  {
    key: 'fuel',
    label: 'Fuel Level',
    icon: Fuel,
    displayOrder: 1,
    readingType: 'percentage',
    unit: '%',
    scaleMin: 0, scaleMax: 100,
    scaleMarks: [{ value: 0, label: 'E' }, { value: 25, label: '25' }, { value: 50, label: '50' }, { value: 75, label: '75' }, { value: 100, label: 'F' }],
    endpointLabels: ['E', 'F'],
    thresholds: { critical: [0, 10], low: [10, 30], normal: [30, 90], full: [90, 100] },
  },
  {
    key: 'coolant',
    label: 'Water Temperature',
    icon: Thermometer,
    displayOrder: 2,
    readingType: 'range',
    scaleMin: 0, scaleMax: 100,
    scaleMarks: [{ value: 0, label: 'C' }, { value: 33, label: '' }, { value: 50, label: 'Normal' }, { value: 67, label: '' }, { value: 100, label: 'H' }],
    endpointLabels: ['C', 'H'],
    rangeStates: ['Cold', 'Normal', 'Warning', 'High', 'Critical High'],
    rangePositions: { 'Cold': 15, 'Normal': 45, 'Warning': 65, 'High': 80, 'Critical High': 95 },
  },
  {
    key: 'frontAir',
    label: 'Front Air Pressure',
    icon: Gauge,
    displayOrder: 3,
    readingType: 'numeric',
    unit: 'kg/cm²',
    scaleMin: 0, scaleMax: 15,
    scaleMarks: [{ value: 0, label: '0' }, { value: 5, label: '5' }, { value: 10, label: '10' }, { value: 15, label: '15' }],
    endpointLabels: ['0', '15'],
    thresholds: { criticalLow: [0, 3], low: [3, 6], normal: [6, 12], high: [12, 15] },
  },
  {
    key: 'rearAir',
    label: 'Rear Air Pressure',
    icon: Gauge,
    displayOrder: 4,
    readingType: 'numeric',
    unit: 'kg/cm²',
    scaleMin: 0, scaleMax: 15,
    scaleMarks: [{ value: 0, label: '0' }, { value: 5, label: '5' }, { value: 10, label: '10' }, { value: 15, label: '15' }],
    endpointLabels: ['0', '15'],
    thresholds: { criticalLow: [0, 3], low: [3, 6], normal: [6, 12], high: [12, 15] },
  },
  {
    key: 'battery',
    label: 'Battery Status',
    icon: Battery,
    displayOrder: 5,
    readingType: 'range',
    scaleMin: 0, scaleMax: 100,
    scaleMarks: [{ value: 0, label: 'L' }, { value: 50, label: '' }, { value: 100, label: 'H' }],
    endpointLabels: ['L', 'H'],
    rangeStates: ['Low', 'Normal', 'High'],
    rangePositions: { 'Low': 20, 'Normal': 50, 'High': 85 },
  },
  {
    key: 'oilPressure',
    label: 'Oil Level',
    icon: Droplets,
    displayOrder: 6,
    readingType: 'range',
    scaleMin: 0, scaleMax: 100,
    scaleMarks: [{ value: 0, label: 'L' }, { value: 50, label: '' }, { value: 100, label: 'H' }],
    endpointLabels: ['L', 'H'],
    rangeStates: ['Critical Low', 'Low', 'Normal', 'High'],
    rangePositions: { 'Critical Low': 10, 'Low': 25, 'Normal': 50, 'High': 85 },
  },
];

/* Helper: get the normalized 0-100 needle position for any gauge reading */
function getGaugeNeedlePosition(gauge) {
  // Camera numbers never use the legacy, physically unverified gauge scales.
  if (gauge?.source === 'camera') return null;
  if (!gauge || gauge.status === 'No Data' || gauge.status === 'Camera Offline' || gauge.status === 'Image Unclear' || gauge.status === 'Analysis Failed') return null;
  const param = GAUGE_PARAMETERS.find(p => p.key === gauge.gaugeKey);
  if (!param) return null;
  if (param.readingType === 'percentage') {
    return gauge.estimatedPercent != null ? gauge.estimatedPercent : null;
  }
  if (param.readingType === 'numeric') {
    if (gauge.numericValue == null) return null;
    return Math.max(0, Math.min(100, ((gauge.numericValue - param.scaleMin) / (param.scaleMax - param.scaleMin)) * 100));
  }
  if (param.readingType === 'range') {
    if (!gauge.rangeState || !param.rangePositions) return null;
    return param.rangePositions[gauge.rangeState] ?? 50;
  }
  return null;
}

/* Helper: get the primary display string for a gauge reading */
function getGaugeDisplayReading(gauge) {
  if (!gauge) return 'No Data';
  if (gauge.source === 'camera') return Number.isFinite(gauge.numericValue) ? `${gauge.numericValue} ${gauge.unit}` : 'Awaiting Data';
  const unavailable = ['No Data', 'Camera Offline', 'Image Unclear', 'Analysis Failed', 'Camera Obstructed'];
  if (unavailable.includes(gauge.status)) return gauge.status;
  const param = GAUGE_PARAMETERS.find(p => p.key === gauge.gaugeKey);
  if (!param) return 'No Data';
  if (param.readingType === 'percentage') {
    return gauge.estimatedPercent != null ? `Estimated ${gauge.estimatedPercent}%` : 'No Data';
  }
  if (param.readingType === 'numeric') {
    return gauge.numericValue != null ? `${gauge.numericValue} ${param.unit}` : 'No Data';
  }
  if (param.readingType === 'range') {
    return gauge.rangeState ? `${gauge.rangeState} Range` : 'No Data';
  }
  return 'No Data';
}

/* Helper: get the status color key for a gauge */
function getGaugeStatusColor(status) {
  if (!status) return '#cbd5e1';
  if (status === 'Normal' || status === 'Full') return '#10b981';
  if (status === 'Low' || status === 'Warning' || status === 'High' || status === 'Low Pressure' || status === 'High Pressure' || status === 'Cold') return '#f59e0b';
  if (status.includes('Critical')) return '#ef4444';
  return '#cbd5e1';
}

const NORMAL_CONDITION_STATUSES = new Set(['Normal', 'Full']);
const UNAVAILABLE_CONDITION_STATUSES = new Set(['No Data', 'Camera Offline', 'Image Unclear', 'Analysis Failed', 'Camera Obstructed', 'Unknown', 'Offline']);

function getConditionSeverity(status) {
  if (!status || NORMAL_CONDITION_STATUSES.has(status) || UNAVAILABLE_CONDITION_STATUSES.has(status)) return null;
  return String(status).toLowerCase().includes('critical') ? 'Critical' : 'Warning';
}

function isSampleConditionTelemetry(bus) {
  return bus?.usesInitialSampleTelemetry === true;
}

function withoutSampleConditionTelemetry(bus) {
  if (!isSampleConditionTelemetry(bus)) return bus;
  return {
    ...bus,
    gaugeReadings: [],
    overallGaugeStatus: undefined,
    lastGaugeAnalysisMs: undefined,
    gaugeImageStatus: undefined,
  };
}

export function hasValidatedConditionData(bus) {
  if (!bus || isSampleConditionTelemetry(bus)) return false;
  const hasMeaningfulStatus = (status) => Boolean(
    status
    && !UNAVAILABLE_CONDITION_STATUSES.has(status)
    && (NORMAL_CONDITION_STATUSES.has(status) || getConditionSeverity(status)),
  );
  const hasNumericReading = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const gauges = Array.isArray(bus.gaugeReadings) ? bus.gaugeReadings : [];
  return hasMeaningfulStatus(bus.overallGaugeStatus)
    || gauges.some((gauge) => hasMeaningfulStatus(gauge.status) || hasNumericReading(gauge.numericValue) || hasNumericReading(gauge.estimatedPercent));
}

export function getOverallVehicleCondition(bus) {
  if (!bus || isSampleConditionTelemetry(bus)) return 'No Data';
  const conditionStatuses = [
    bus.overallGaugeStatus,
    ...(Array.isArray(bus.gaugeReadings) ? bus.gaugeReadings.map((gauge) => gauge.status) : []),
  ].filter(Boolean);

  if (conditionStatuses.some((status) => getConditionSeverity(status) === 'Critical')) return 'Critical';
  if (conditionStatuses.some((status) => getConditionSeverity(status) === 'Warning')) return 'Warning';
  if (conditionStatuses.length > 0 && conditionStatuses.every((status) => NORMAL_CONDITION_STATUSES.has(status))) return 'Normal';
  return 'No Data';
}

export function getFleetHealthCounts(buses) {
  return buses.reduce((counts, bus) => {
    const condition = getOverallVehicleCondition(bus);
    return {
      ...counts,
      total: counts.total + 1,
      active: counts.active + (bus.status === 'active' ? 1 : 0),
      inactive: counts.inactive + (bus.status === 'inactive' ? 1 : 0),
      normal: counts.normal + (condition === 'Normal' ? 1 : 0),
      warning: counts.warning + (condition === 'Warning' ? 1 : 0),
      critical: counts.critical + (condition === 'Critical' ? 1 : 0),
      unknown: counts.unknown + (condition === 'No Data' ? 1 : 0),
    };
  }, { total: 0, active: 0, inactive: 0, normal: 0, warning: 0, critical: 0, unknown: 0 });
}

function latestSensorReadings(readings, identity, timestamp) {
  const latest = new window.Map();
  for (const reading of readings) {
    const key = identity(reading);
    const previous = latest.get(key);
    if (!previous || getTimestampMs(timestamp(reading)) >= getTimestampMs(timestamp(previous))) latest.set(key, reading);
  }
  return [...latest.values()];
}

export function getNeedsAttentionIssues(buses, limit = 3) {
  const issues = buses.flatMap((bus) => {
    if (isSampleConditionTelemetry(bus)) return [];
    const plateNumber = bus.plateNumber || bus.plate || bus.id;
    const gauges = latestSensorReadings(Array.isArray(bus.gaugeReadings) ? bus.gaugeReadings : [], (gauge) => gauge.gaugeKey || gauge.label || gauge.id, (gauge) => gauge.analyzedAt || gauge.capturedAt);
    const gaugeIssues = gauges.flatMap((gauge) => {
      const severity = getConditionSeverity(gauge.status);
      if (!severity) return [];
      return [{
        id: `gauge-${bus.id}-${gauge.gaugeKey || gauge.label || gauge.id}`,
        busId: bus.id,
        plateNumber,
        severity,
        label: gauge.label || GAUGE_PARAMETERS.find((parameter) => parameter.key === gauge.gaugeKey)?.label || 'Vehicle condition issue',
        reading: getGaugeDisplayReading(gauge),
        updatedAtMs: gauge.analyzedAt || gauge.capturedAt || bus.lastGaugeAnalysisMs || 0,
      }];
    });
    const gaugeSummarySeverity = getConditionSeverity(bus.overallGaugeStatus);
    const summaryIssues = [
      ...(gauges.length === 0 && gaugeSummarySeverity ? [{
        id: `gauge-summary-${bus.id}`,
        busId: bus.id,
        plateNumber,
        severity: gaugeSummarySeverity,
        label: 'Gauge Panel Condition',
        reading: bus.overallGaugeStatus,
        updatedAtMs: bus.lastGaugeAnalysisMs || 0,
      }] : []),
    ];
    return [...gaugeIssues, ...summaryIssues];
  });

  return issues
    .sort((first, second) => (first.severity === second.severity ? second.updatedAtMs - first.updatedAtMs : first.severity === 'Critical' ? -1 : 1))
    .slice(0, limit);
}

const fpipToLimaWaypoints = [
  { label: 'FPIP', lat: 14.135645, lng: 121.122123 },
  { label: 'Tanauan Gateway', lat: 14.114492, lng: 121.141803 },
  { label: 'Darasa', lat: 14.088639, lng: 121.14911 },
  { label: 'Malvar', lat: 14.0504, lng: 121.156614 },
  { label: 'LIMA Main Gate', lat: 14.007995, lng: 121.165597 },
  { label: 'LIMA Estate', lat: 14.008703, lng: 121.169172 },
];

const fpipToLimaRoute = [
  { lat: 14.135645, lng: 121.122123 }, { lat: 14.136805, lng: 121.124424 }, { lat: 14.137345, lng: 121.124615 },
  { lat: 14.135421, lng: 121.125594 }, { lat: 14.135899, lng: 121.127262 }, { lat: 14.136663, lng: 121.129112 },
  { lat: 14.13649, lng: 121.130246 }, { lat: 14.135951, lng: 121.131394 }, { lat: 14.13613, lng: 121.132493 },
  { lat: 14.13712, lng: 121.134979 }, { lat: 14.136928, lng: 121.135586 }, { lat: 14.135022, lng: 121.135927 },
  { lat: 14.133205, lng: 121.136389 }, { lat: 14.132551, lng: 121.136594 }, { lat: 14.129294, lng: 121.137548 },
  { lat: 14.128244, lng: 121.137807 }, { lat: 14.126948, lng: 121.13803 }, { lat: 14.124908, lng: 121.138748 },
  { lat: 14.122611, lng: 121.139556 }, { lat: 14.122242, lng: 121.139687 }, { lat: 14.120462, lng: 121.140367 },
  { lat: 14.119186, lng: 121.140888 }, { lat: 14.117842, lng: 121.141438 }, { lat: 14.117119, lng: 121.141534 },
  { lat: 14.115121, lng: 121.141607 }, { lat: 14.114646, lng: 121.141638 }, { lat: 14.114492, lng: 121.141803 },
  { lat: 14.114296, lng: 121.142102 }, { lat: 14.113056, lng: 121.142999 }, { lat: 14.111357, lng: 121.144284 },
  { lat: 14.110446, lng: 121.144987 }, { lat: 14.109603, lng: 121.145646 }, { lat: 14.108489, lng: 121.146496 },
  { lat: 14.106399, lng: 121.148046 }, { lat: 14.106087, lng: 121.148079 }, { lat: 14.105396, lng: 121.148062 },
  { lat: 14.104085, lng: 121.147898 }, { lat: 14.099931, lng: 121.147168 }, { lat: 14.099511, lng: 121.147158 },
  { lat: 14.098289, lng: 121.147518 }, { lat: 14.097409, lng: 121.147745 }, { lat: 14.0962, lng: 121.148069 },
  { lat: 14.094504, lng: 121.148533 }, { lat: 14.093189, lng: 121.148907 }, { lat: 14.092582, lng: 121.149041 },
  { lat: 14.091465, lng: 121.149051 }, { lat: 14.090712, lng: 121.148906 }, { lat: 14.08997, lng: 121.148908 },
  { lat: 14.088639, lng: 121.14911 }, { lat: 14.087625, lng: 121.149274 }, { lat: 14.085564, lng: 121.149607 },
  { lat: 14.083321, lng: 121.149964 }, { lat: 14.080751, lng: 121.150359 }, { lat: 14.080066, lng: 121.150519 },
  { lat: 14.078743, lng: 121.150742 }, { lat: 14.077527, lng: 121.150949 }, { lat: 14.07511, lng: 121.151359 },
  { lat: 14.073856, lng: 121.151562 }, { lat: 14.071784, lng: 121.151922 }, { lat: 14.06987, lng: 121.152342 },
  { lat: 14.068588, lng: 121.152671 }, { lat: 14.067371, lng: 121.152985 }, { lat: 14.066445, lng: 121.153219 },
  { lat: 14.063782, lng: 121.153716 }, { lat: 14.06133, lng: 121.154126 }, { lat: 14.060023, lng: 121.15425 },
  { lat: 14.059429, lng: 121.154252 }, { lat: 14.057963, lng: 121.154312 }, { lat: 14.056677, lng: 121.154604 },
  { lat: 14.055238, lng: 121.154993 }, { lat: 14.054291, lng: 121.155252 }, { lat: 14.052598, lng: 121.15581 },
  { lat: 14.051055, lng: 121.156391 }, { lat: 14.047409, lng: 121.157567 }, { lat: 14.044895, lng: 121.15829 },
  { lat: 14.041986, lng: 121.159082 }, { lat: 14.039795, lng: 121.159644 }, { lat: 14.038371, lng: 121.160001 },
  { lat: 14.037335, lng: 121.160275 }, { lat: 14.035823, lng: 121.16068 }, { lat: 14.033672, lng: 121.16131 },
  { lat: 14.032216, lng: 121.161754 }, { lat: 14.030488, lng: 121.162204 }, { lat: 14.028591, lng: 121.162497 },
  { lat: 14.025964, lng: 121.162179 }, { lat: 14.024037, lng: 121.161791 }, { lat: 14.022564, lng: 121.161649 },
  { lat: 14.020275, lng: 121.162438 }, { lat: 14.01916, lng: 121.162762 }, { lat: 14.01655, lng: 121.163462 },
  { lat: 14.015106, lng: 121.163818 }, { lat: 14.013432, lng: 121.164249 }, { lat: 14.011915, lng: 121.164656 },
  { lat: 14.010193, lng: 121.16512 }, { lat: 14.009255, lng: 121.165354 }, { lat: 14.007995, lng: 121.165597 },
  { lat: 14.009485, lng: 121.168147 }, { lat: 14.008855, lng: 121.168665 }, { lat: 14.008703, lng: 121.169172 },
];

const getRelativeTime = (timestampMs) => {
  if (!timestampMs) return 'No data';
  const diffInSeconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  return `${Math.floor(diffInSeconds / 86400)} days ago`;
};

const formatTimestamp = (timestampMs) => {
  if (!timestampMs) return 'No data';
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(timestampMs));
};

const getAlertCategory = (alert) => alert.category || alert.severity || 'System';
const getAlertSeverity = (alert) => {
  const severity = String(alert.severity || '').toLowerCase();
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  if (severity === 'information') return 'Information';
  if (/critical/i.test(alert.title)) return 'Critical';
  return 'Warning';
};
const getAlertStatus = (alert) => alert.workflowStatus === 'Under Review' ? 'Investigating' : (alert.workflowStatus || alert.status || 'New');
const isUnacknowledgedAlert = (alert) => !isRetiredTirePressureAlert(alert) && ['New', 'Investigating'].includes(getAlertStatus(alert));

export const isActiveIssue = (alert) => !isRetiredTirePressureAlert(alert) && ['New', 'Investigating', 'Acknowledged', 'Active'].includes(getAlertStatus(alert));

// Input is generated from the latest fleet conditions, never Activity Records.
export function deriveMonitoringState(buses, conditionAlerts) {
  const fleet = new window.Map(buses.filter((bus) => bus.isArchived !== true && bus.isPlaceholder !== true).map((bus) => [bus.id, bus]));
  const uniqueIssues = new window.Map();
  for (const alert of conditionAlerts) {
    if (isRetiredTirePressureAlert(alert)) continue;
    const busId = alert.busId || alert.busNumber;
    if (!fleet.has(busId)) continue;
    const category = getAlertCategory(alert);
    if (category === 'Vehicle Condition' && isSampleConditionTelemetry(fleet.get(busId))) continue;
    const identity = category === 'Route' ? 'route-deviation' : (alert.issueKey || alert.gaugeKey || alert.sensorType || alert.title || alert.id);
    const key = JSON.stringify([busId, category, identity]);
    const previous = uniqueIssues.get(key);
    if (!previous || getTimestampMs(alert.timestampMs) >= getTimestampMs(previous.timestampMs)) uniqueIssues.set(key, alert);
  }
  const alerts = [...uniqueIssues.values()];
  const activeAlerts = alerts.filter(isActiveIssue);
  const vehicleIssues = activeAlerts.filter((alert) => getAlertCategory(alert) === 'Vehicle Condition');
  const warningIssueCount = vehicleIssues.filter((alert) => getAlertSeverity(alert) === 'Warning').length;
  const criticalIssueCount = vehicleIssues.filter((alert) => getAlertSeverity(alert) === 'Critical').length;
  return {
    alerts,
    activeAlerts,
    activeBusCount: [...fleet.values()].filter((bus) => bus.status === 'active').length,
    conditionDataAvailableBusCount: [...fleet.values()].filter(hasValidatedConditionData).length,
    conditionDataAwaitingBusCount: [...fleet.values()].filter((bus) => !hasValidatedConditionData(bus)).length,
    warningIssueCount,
    criticalIssueCount,
    vehicleIssueCount: warningIssueCount + criticalIssueCount,
    activeRouteDeviationCount: [...fleet.values()].filter(isConfirmedRouteDeviation).length,
  };
}

const createMockData = () => {
  const now = Date.now();
  const trips = [
    {
      id: 'TRIP-001',
      date: new Date().toISOString().split('T')[0],
      time: '6:30 AM',
      origin: 'FPIP',
      destination: 'LIMA',
      routeLabel: 'FPIP–LIMA',
      originCoordinates: { lat: 14.135645, lng: 121.122123 },
      destinationCoordinates: { lat: 14.008703, lng: 121.169172 },
      busNumber: 'BUS-104',
      driver: 'Ramon Dela Cruz',
      deviationM: ROUTE_DEVIATION_DEFAULT_M,
      notes: 'Morning FPIP-LIMA schedule.',
      status: 'Active',
      routeStatus: 'Compliant',
    },
    {
      id: 'TRIP-002',
      date: new Date().toISOString().split('T')[0],
      time: '5:30 PM',
      origin: 'LIMA',
      destination: 'FPIP',
      routeLabel: 'LIMA–FPIP',
      originCoordinates: { lat: 14.008703, lng: 121.169172 },
      destinationCoordinates: { lat: 14.135645, lng: 121.122123 },
      busNumber: 'BUS-118',
      driver: 'Alvin Santos',
      deviationM: ROUTE_DEVIATION_DEFAULT_M,
      notes: 'Afternoon LIMA-FPIP schedule.',
      status: 'Scheduled',
      routeStatus: 'Route Deviation',
    },
  ];

  const buses = [
    {
      id: 'bus-01',
      number: 'BUS-104',
      plate: 'NCR 4821',
      driver: 'Ramon Dela Cruz',
      tripId: 'TRIP-001',
      speed: 46,
      location: 'Darasa, Tanauan',
      coordinates: { lat: 14.0889, lng: 121.1493 },
      connection: 'Online',
      sync: 'Synced',
      lastUpdateMs: now - 8000,
      etaNextStop: '8 min',
      distanceToday: '31.4 km',
      routeLabel: 'FPIP–LIMA',
      routeStatus: 'Compliant',
    },
    {
      id: 'bus-02',
      number: 'BUS-118',
      plate: 'DAB 7319',
      driver: 'Alvin Santos',
      tripId: 'TRIP-002',
      speed: 34,
      location: 'Malvar, Batangas',
      coordinates: { lat: 14.0504, lng: 121.1778 },
      connection: 'Online',
      sync: 'Pending Sync',
      lastUpdateMs: now - 45000,
      etaNextStop: '12 min',
      distanceToday: '27.8 km',
      routeLabel: 'LIMA–FPIP',
      routeStatus: 'Route Deviation',
    },
  ];

  return { trips, buses };
};

const initialData = createMockData();

export function normalizeOperationalBuses(buses) {
  return buses.map((bus, index) => {
    const templateIndex = buses.length === 1 ? 1 : index % initialData.buses.length;
    const template = initialData.buses[templateIndex];
    const operationalBus = withoutSampleConditionTelemetry(bus);

    return {
      ...operationalBus,
      routeName: operationalBus.routeName || template.routeLabel,
      driverName: operationalBus.driverName || 'No driver assigned',
      routeStatus: operationalBus.routeStatus || template.routeStatus,
      deviationM: bus.deviationM ?? (template.routeStatus === 'Route Deviation' ? 420 : undefined),
    };
  });
}

function buildSynchronizedSampleData(buses) {
  if (buses.length === 0) return { trips: [] };
  const trips = buses.map((bus, index) => ({
    ...initialData.trips[index % initialData.trips.length],
    id: `sample-trip-${bus.id}`,
    busId: bus.id,
    busNumber: bus.id,
    routeLabel: bus.routeName || 'No route assigned',
    driver: 'No driver assigned',
    status: bus.status === 'active' ? 'Active' : 'Scheduled',
  }));
  return { trips };
}
const semanticBadgeStyles = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-[#F2D98C] bg-[#FFF7DB] text-[#9A6800]',
  red: 'border-[#E9B9BF] bg-[#FBEDEE] text-[#8E1F2F]',
  gray: 'border-slate-200 bg-slate-50 text-slate-600',
  maroon: 'border-[#E9C3C8] bg-[#FBEDEE] text-[#7A1F2B]',
};

const statusColorMeaning = {
  Normal: 'green',
  Compliant: 'green',
  Online: 'green',
  Synced: 'green',
  Active: 'green',
  Resolved: 'green',
  Live: 'green',
  Full: 'green',
  'Analysis Complete': 'green',
  Warning: 'amber',
  Low: 'amber',
  High: 'amber',
  Cold: 'amber',
  'Low Pressure': 'amber',
  'High Pressure': 'amber',
  Delayed: 'amber',
  'Pending Sync': 'amber',
  'Stored Locally': 'amber',
  'Weak Signal': 'amber',
  'Under Review': 'amber',
  Scheduled: 'amber',
  'Route Deviation': 'red',
  New: 'red',
  Critical: 'red',
  'Critical Low': 'red',
  'Critical High': 'red',
  'Critical Low Pressure': 'red',
  'Missed Checkpoint': 'red',
  'Unexpected Stop': 'red',
  Offline: 'gray',
  'No Data': 'gray',
  'Image Unclear': 'gray',
  'Camera Offline': 'gray',
  Acknowledged: 'maroon',
  Investigating: 'maroon',
  Information: 'maroon',
  Logged: 'maroon',
  Processing: 'maroon',
  'Vehicle Condition': 'amber',
  Route: 'red',
  Connectivity: 'gray',
  System: 'gray',
  Failed: 'red',
  Inactive: 'gray',
  Maintenance: 'amber',
};

function getStatusBadgeStyle(value) {
  return semanticBadgeStyles[statusColorMeaning[value] || 'gray'];
}

function getBusStatusLabel(status) {
  switch (status) {
    case 'active': return 'Active';
    case 'maintenance': return 'Maintenance';
    case 'offline': return 'Offline';
    case 'inactive':
    default: return 'Inactive';
  }
}

function BusStatusBadge({ status }) {
  return <StatusBadge value={getBusStatusLabel(status)} />;
}

function validGpsPair(lat, lng) {
  return (typeof lat === 'number' || (typeof lat === 'string' && lat.trim() !== ''))
    && (typeof lng === 'number' || (typeof lng === 'string' && lng.trim() !== ''))
    && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}

export function getBusCoordinates(bus) {
  // The monitor classifies this filtered/anchored pair. Older payloads may
  // contain a different responsive pair; never prefer it over the assessed pair.
  const trustedLat = bus?.gps?.latitude;
  const trustedLng = bus?.gps?.longitude;

  if (validGpsPair(trustedLat, trustedLng)) {
    return {
      lat: Number(trustedLat),
      lng: Number(trustedLng),
    };
  }

  const liveLat = bus?.gps?.liveLatitude;
  const liveLng = bus?.gps?.liveLongitude;
  if (validGpsPair(liveLat, liveLng)) return { lat: Number(liveLat), lng: Number(liveLng) };

  const lastKnown = bus?.gps?.lastKnownPosition;
  return validGpsPair(lastKnown?.lat, lastKnown?.lng)
    ? { lat: Number(lastKnown.lat), lng: Number(lastKnown.lng) } : null;
}

// Local display metadata only: never overwrite the received GPS fields or times.
function retainLastKnownPosition(previous, gps) {
  // Only a real incoming coordinate may acquire a new capture time. A cached
  // fallback must never be retimestamped by a heartbeat/invalid position.
  const coordinates = getBusCoordinates({ gps: { ...gps, lastKnownPosition: null } });
  const capturedAt = getGpsSampleTimestamp(gps);
  return {
    ...gps,
    lastKnownPosition: coordinates
      ? { ...coordinates, capturedAt }
      : previous?.lastKnownPosition || gps?.lastKnownPosition || null,
  };
}

export function getMarkerGpsFreshness(bus, nowMs) {
  const gps = bus?.gps;
  if (validGpsPair(gps?.liveLatitude, gps?.liveLongitude) || validGpsPair(gps?.latitude, gps?.longitude)) {
    return getGpsFreshness(bus, nowMs);
  }
  return getGpsFreshness({ gps: { online: gps?.online, gpsUpdatedAt: gps?.lastKnownPosition?.capturedAt } }, nowMs);
}

// Allow bounded sub-second/1 Hz clock jitter, not materially future fixes.
export const GPS_DISPLAY_MAX_FUTURE_SKEW_MS = 2_000;

export function getGpsFreshness(bus, nowMs = Date.now()) {
  const updatedAtMs = getGpsSampleTimestamp(bus?.gps);
  const hasValidTimestamp = Number.isFinite(updatedAtMs) && updatedAtMs > 0 && Number.isFinite(new Date(updatedAtMs).getTime());
  if (hasValidTimestamp && updatedAtMs > nowMs + GPS_DISPLAY_MAX_FUTURE_SKEW_MS) return { status: 'Unknown', updatedAtMs: null, ageMs: null, reason: 'future-timestamp' };
  if (bus?.gps?.online === false) return { status: 'Offline', updatedAtMs: hasValidTimestamp ? updatedAtMs : null, ageMs: hasValidTimestamp ? Math.max(0, nowMs - updatedAtMs) : null };
  if (!hasValidTimestamp) return { status: 'Unknown', updatedAtMs: null, ageMs: null };
  const ageMs = Math.max(0, nowMs - updatedAtMs);
  if (ageMs <= 30_000) return { status: 'Online', updatedAtMs, ageMs };
  if (ageMs <= 60_000) return { status: 'Delayed', updatedAtMs, ageMs };
  return { status: 'Stale', updatedAtMs, ageMs };
}

export function getGpsSampleTimestamp(gps) {
  const parseTimestamp = (value) => {
    if (value == null || value === '') return null;

    const numericTimestamp = Number(value);
    if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
      return numericTimestamp;
    }

    const dateTimestamp = Date.parse(String(value));
    return Number.isFinite(dateTimestamp) && dateTimestamp > 0 ? dateTimestamp : null;
  };

  return parseTimestamp(gps?.gpsUpdatedAt) ?? parseTimestamp(gps?.updatedAt);
}

function getLatestHealthTimestamp(gpsRecords, fieldNames) {
  return gpsRecords.reduce((latest, gps) => {
    let candidate = null;
    for (const fieldName of fieldNames) {
      const rawValue = gps?.[fieldName];
      const numericValue = Number(rawValue);
      const value = Number.isFinite(numericValue) && numericValue > 0
        ? numericValue
        : Date.parse(String(rawValue ?? ''));

      if (Number.isFinite(value) && value > 0) {
        candidate = value;
        break;
      }
    }
    return candidate == null ? latest : Math.max(latest, candidate);
  }, 0) || null;
}

function toPositiveTimestamp(value) {
  if (value == null || value === '') return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function createHealthSignal(status, timestampMs, nowMs) {
  const validTimestamp = toPositiveTimestamp(timestampMs);
  return {
    status,
    timestampMs: validTimestamp,
    ageMs: validTimestamp == null ? null : Math.max(0, nowMs - validTimestamp),
  };
}

export function deriveBackendHealthStatus(backendPoll, nowMs = Date.now()) {
  if (backendPoll?.configured === false) return {
    ...createHealthSignal('NOT CONFIGURED', null, nowMs),
    detail: 'The approved HTTPS backend URL has not been configured.',
  };
  const lastSuccessAt = toPositiveTimestamp(backendPoll?.lastSuccessAt);
  const consecutiveFailures = Number(backendPoll?.consecutiveFailures) || 0;
  const hasAttempted = backendPoll?.hasAttempted === true;
  const successAgeMs = lastSuccessAt == null ? null : Math.max(0, nowMs - lastSuccessAt);

  if (!hasAttempted) return createHealthSignal('CHECKING', null, nowMs);
  if (
    consecutiveFailures >= SYSTEM_HEALTH_THRESHOLDS.backendFailureLimit
    || (successAgeMs != null && successAgeMs > SYSTEM_HEALTH_THRESHOLDS.backendOfflineMs)
  ) return createHealthSignal('OFFLINE', lastSuccessAt, nowMs);
  if (consecutiveFailures > 0 || lastSuccessAt == null) return createHealthSignal('DEGRADED', lastSuccessAt, nowMs);
  return createHealthSignal('ONLINE', lastSuccessAt, nowMs);
}

export function deriveDashboardConnectivityStatus(backendHealth = {}) {
  const status = backendHealth?.status || 'CHECKING';
  if (status === 'ONLINE') return {
    label: 'Internet connected',
    detail: 'The dashboard can reach its HTTPS backend. Bus GPS freshness is shown separately.',
    tone: 'healthy',
  };
  if (status === 'DEGRADED') return {
    label: 'Internet connection unstable',
    detail: 'Recent HTTPS backend checks failed. The network or backend may be unstable.',
    tone: 'degraded',
  };
  if (status === 'OFFLINE') return {
    label: 'Cloud unreachable',
    detail: 'The dashboard cannot reach its HTTPS backend. Check internet access and backend status.',
    tone: 'offline',
  };
  if (status === 'NOT CONFIGURED') return {
    label: 'Backend not configured',
    detail: 'The dashboard HTTPS backend URL is not configured.',
    tone: 'neutral',
  };
  return {
    label: 'Checking internet',
    detail: 'Waiting for the first HTTPS backend health check.',
    tone: 'neutral',
  };
}

export function deriveRealtimeHealth(realtime = {}, nowMs = Date.now()) {
  const channelStatus = realtime.channelStatus || 'PENDING';
  const status = {
    PENDING: 'CONNECTING',
    CONNECTING: 'CONNECTING',
    SUBSCRIBED: 'LIVE',
    CHANNEL_ERROR: 'CHANNEL_ERROR',
    TIMED_OUT: 'TIMED_OUT',
    CLOSED: 'CLOSED',
  }[channelStatus] || 'UNKNOWN';
  // Channel subscription is transport evidence, not GPS freshness or RLS proof.
  return {
    ...createHealthSignal(status, realtime.changedAt, nowMs),
    channelStatus,
    readStatus: realtime.readStatus || 'PENDING',
    lastEventAt: toPositiveTimestamp(realtime.lastEventAt),
  };
}

export function deriveSystemHealth({
  gpsByBusId = {},
  backendPoll = {},
  realtime = {},
  nowMs = Date.now(),
} = {}) {
  const gpsRecords = Object.values(gpsByBusId || {});
  const gpsTimestampMs = getLatestHealthTimestamp(gpsRecords.map((gps) => ({
    capturedAt: gps.lastKnownPosition
      ? getMarkerGpsFreshness({ gps }, nowMs).updatedAtMs : getGpsSampleTimestamp(gps),
  })).filter(({ capturedAt }) => Number.isFinite(capturedAt) && capturedAt <= nowMs + GPS_DISPLAY_MAX_FUTURE_SKEW_MS), ['capturedAt']);
  const gpsAgeMs = gpsTimestampMs == null ? null : Math.max(0, nowMs - gpsTimestampMs);
  const backend = deriveBackendHealthStatus(backendPoll, nowMs);

  const hasAvailableFix = gpsRecords.some((record) => !record.sourceUnavailable
    && record.online !== false && getGpsSampleTimestamp(record) === gpsTimestampMs);
  const gpsStatus = gpsAgeMs == null ? 'NO DATA'
    : hasAvailableFix && gpsAgeMs <= SYSTEM_HEALTH_THRESHOLDS.gpsLiveMs ? 'LIVE' : 'STALE';
  const gps = createHealthSignal(gpsStatus, gpsTimestampMs, nowMs);

  // A heartbeat proves the device can reach the backend, while GPS freshness
  // remains driven exclusively by gpsUpdatedAt from the accepted live fix.
  const lastPacketReceivedAt = toPositiveTimestamp(
    backendPoll?.data?.lastPacketReceivedAt
      ?? backendPoll?.data?.lastTelemetryReceivedAt,
  );
  let piStatus = 'UNKNOWN';
  if (!['OFFLINE', 'NOT CONFIGURED'].includes(backend.status) && Number.isFinite(lastPacketReceivedAt) && lastPacketReceivedAt > 0) {
    const telemetryAgeMs = Math.max(0, nowMs - lastPacketReceivedAt);
    piStatus = telemetryAgeMs <= SYSTEM_HEALTH_THRESHOLDS.deviceOnlineMs
      ? 'ONLINE'
      : telemetryAgeMs <= SYSTEM_HEALTH_THRESHOLDS.deviceDelayedMs ? 'DELAYED' : 'OFFLINE';
  }
  const raspberryPi = createHealthSignal(piStatus, lastPacketReceivedAt, nowMs);

  const stream = deriveRealtimeHealth(realtime, nowMs);

  let overall = { label: 'ALL SYSTEMS LIVE', tone: 'healthy' };
  if (backend.status === 'NOT CONFIGURED') overall = { label: 'BACKEND NOT CONFIGURED', tone: 'warning' };
  else if (backend.status === 'OFFLINE') overall = { label: 'BACKEND UNREACHABLE', tone: 'critical' };
  else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(stream.status)) overall = { label: 'DATA STREAM UNAVAILABLE', tone: 'critical' };
  else if (stream.readStatus === 'ERROR') overall = { label: 'GPS DATA READ FAILED', tone: 'critical' };
  else if (raspberryPi.status === 'OFFLINE') overall = { label: 'NO GPS DEVICE PACKETS', tone: 'critical' };
  else if (gps.status === 'NO DATA') overall = { label: 'GPS NO DATA', tone: 'critical' };
  else if (gps.status === 'STALE') overall = { label: 'GPS DATA STALE', tone: 'warning' };
  else if (backend.status === 'DEGRADED') overall = { label: 'BACKEND DEGRADED', tone: 'warning' };
  else if (raspberryPi.status === 'DELAYED') overall = { label: 'GPS DEVICE PACKETS DELAYED', tone: 'warning' };
  else if (backend.status === 'CHECKING' || raspberryPi.status === 'UNKNOWN' || ['CONNECTING', 'UNKNOWN'].includes(stream.status)) overall = { label: 'CHECKING SYSTEM HEALTH', tone: 'neutral' };

  // A channel status change is not a newly received telemetry/data sample.
  const latestSignalAt = [gps.timestampMs, raspberryPi.timestampMs, backend.timestampMs, stream.lastEventAt]
    .filter((value) => Number.isFinite(value))
    .reduce((latest, value) => Math.max(latest, value), 0) || null;

  return { gps, raspberryPi, backend, realtime: stream, overall, latestSignalAt };
}

export function appendGpsSpeedSample(history, gps) {
  const timestamp = getGpsSampleTimestamp(gps);
  const rawSpeed = toFiniteGpsNumber(gps?.rawSpeedKmh);
  if (timestamp == null || rawSpeed == null) return history;
  const sample = { timestamp, rawSpeed };
  return [...history.filter((point) => point.timestamp !== timestamp), sample]
    .filter((point) => timestamp - point.timestamp <= 60_000 && point.timestamp <= timestamp)
    .sort((first, second) => first.timestamp - second.timestamp)
    .slice(-120);
}

const routeMonitoringStatuses = {
  'ON ROUTE': {
    label: 'On Route',
    tone: 'success',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  'OUTSIDE CHECK 1/3': {
    label: 'Outside Check 1/3',
    tone: 'caution',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  'OUTSIDE CHECK 2/3': {
    label: 'Outside Check 2/3',
    tone: 'caution',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  'POSSIBLE DEVIATION': {
    label: 'Possible Deviation',
    tone: 'warning',
    className: 'border-orange-200 bg-orange-50 text-orange-700',
  },
  'CONFIRMED DEVIATION': {
    label: 'Confirmed Deviation',
    tone: 'critical',
    className: 'border-red-200 bg-red-50 text-red-700',
  },
};

const unavailableRouteStatus = {
  label: 'Unavailable',
  tone: 'unavailable',
  className: 'border-slate-200 bg-slate-50 text-slate-600',
};

export function getRouteStatusPresentation(value) {
  if (typeof value !== 'string') return unavailableRouteStatus;
  return routeMonitoringStatuses[value.trim().toUpperCase()] || unavailableRouteStatus;
}

function normalizeRouteStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isConfirmedRouteDeviation(bus) {
  return normalizeRouteStatus(bus?.gps?.routeStatus) === 'CONFIRMED DEVIATION';
}

export function formatDistanceFromRoute(value) {
  if (value == null || value === '') return 'Unavailable';
  const distanceM = Number(value);
  if (!Number.isFinite(distanceM) || distanceM < 0) return 'Unavailable';
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(2)} km`;
}

export function getRouteAssessmentPresentation(gps, nowMs = Date.now()) {
  const saved = getRouteStatusPresentation(gps?.routeStatus);
  const freshness = getMarkerGpsFreshness({ gps }, nowMs);
  const lastKnown = freshness.status !== 'Online' || !validGpsPair(gps?.latitude, gps?.longitude);
  return {
    ...saved,
    ...(lastKnown ? { ...unavailableRouteStatus, label: `Last known: ${saved.label}` } : {}),
    lastKnown,
    capturedAt: freshness.updatedAtMs ? new Date(freshness.updatedAtMs).toISOString() : null,
  };
}

function RouteMonitoringSection({ gps, nowMs }) {
  const routeStatus = getRouteAssessmentPresentation(gps, nowMs);
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3" aria-label="Route Monitoring">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Route Monitoring</h3>
        <span
          data-route-tone={routeStatus.tone}
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${routeStatus.className}`}
        >
          {routeStatus.label}
        </span>
      </div>
      {routeStatus.lastKnown && <p className="mt-2 text-xs text-slate-500">Not currently verified · {routeStatus.capturedAt ? `Captured ${routeStatus.capturedAt}` : 'Capture time unavailable'}</p>}
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-500">{routeStatus.lastKnown ? 'Last-known distance' : 'Distance From Route'}</span>
        <span className="font-extrabold text-slate-800">{formatDistanceFromRoute(gps?.distanceFromRouteM)}</span>
      </div>
    </div>
  );
}

function RouteStatusBadge({ gps, nowMs }) {
  const presentation = getRouteAssessmentPresentation(gps, nowMs);
  return (
    <div>
    <span
      data-route-tone={presentation.tone}
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${presentation.className}`}
    >
      {presentation.label}
    </span>
      {presentation.lastKnown && <div className="mt-1 text-[10px] text-slate-500">Not currently verified · {presentation.capturedAt ? `Captured ${presentation.capturedAt}` : 'Capture time unavailable'}</div>}
    </div>
  );
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue;
  const parsedValue = new Date(value).getTime();
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

export function buildApplicationAlerts(buses, nowMs = Date.now()) {
  const conditionAlerts = getNeedsAttentionIssues(buses, Number.POSITIVE_INFINITY).map((issue) => ({
    id: `condition-${issue.id}`,
    issueKey: issue.id,
    busId: issue.busId,
    busNumber: issue.busId,
    plateNumber: issue.plateNumber,
    category: 'Vehicle Condition',
    severity: issue.severity,
    title: issue.label,
    description: `${issue.label}: ${issue.reading}.`,
    timestampMs: issue.updatedAtMs || getTimestampMs(buses.find((bus) => bus.id === issue.busId)?.updatedAt),
    status: 'New',
    workflowStatus: 'New',
  }));

  const routeAlerts = buses.flatMap((bus) => {
    if (!isConfirmedRouteDeviation(bus)) return [];
    const distance = formatDistanceFromRoute(bus.gps?.distanceFromRouteM);
    const route = visibleRouteName(bus.routeName);
    return [{
      id: `route-deviation-${bus.id}`,
      issueKey: 'route-deviation',
      busId: bus.id,
      busNumber: bus.id,
      plateNumber: bus.plateNumber,
      routeName: bus.routeName || null,
      category: 'Route',
      type: 'Route Deviation',
      source: 'GPS Route Monitoring',
      severity: 'Critical',
      title: 'Route Deviation Detected',
      description: distance === 'Unavailable'
        ? `Distance from assigned route unavailable${route ? ` · ${route}` : ''}.`
        : `${distance} from assigned route${route ? ` · ${route}` : ''}.`,
      timestampMs: getTimestampMs(bus.gps?.updatedAt),
      status: 'New',
      workflowStatus: 'New',
    }];
  });

  const connectivityAlerts = buses.flatMap((bus) => {
    if (bus.gps?.online !== false) return [];
    const freshness = getGpsFreshness(bus, nowMs);
    return [{
      id: `gps-offline-${bus.id}`,
      busId: bus.id,
      busNumber: bus.id,
      plateNumber: bus.plateNumber,
      category: 'Connectivity',
      severity: 'Warning',
      title: 'GPS Offline',
      description: 'The GPS device reported that it is offline. The last known position remains available.',
      timestampMs: freshness.updatedAtMs || getTimestampMs(bus.updatedAt),
      status: 'New',
      workflowStatus: 'New',
    }];
  });

  return [...conditionAlerts, ...routeAlerts, ...connectivityAlerts]
    .sort((first, second) => second.timestampMs - first.timestampMs);
}

function formatGpsAge(ageMs) {
  if (!Number.isFinite(ageMs)) return 'Age unavailable';
  const seconds = Math.floor(Math.max(0, ageMs) / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function formatCompactGpsAge(ageMs) {
  if (!Number.isFinite(ageMs)) return 'update unknown';
  const seconds = Math.floor(Math.max(0, ageMs) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function formatGpsLastUpdate(freshness) {
  if (!Number.isFinite(freshness.updatedAtMs)) return 'Unknown';
  return `${new Date(freshness.updatedAtMs).toLocaleString()} (${formatGpsAge(freshness.ageMs)})`;
}

export function isMarkerEligible(bus) {
  return Boolean(
    bus?.id
    && bus.isPlaceholder !== true
    && bus.isArchived !== true
    && getBusCoordinates(bus) !== null,
  );
}

function formatRecordTimestamp(value) {
  if (!value) return 'No update recorded';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'No update recorded' : formatTimestamp(date.getTime());
}

// Navigation identity stays high contrast. GPS/operational status is explicit
// in the card; freshness adds only a secondary halo, never recolors the body.
const BUS_MARKER_IDENTITY_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#16a34a',
  '#ea580c',
  '#4f46e5',
  '#0f766e',
];

export function getBusMarkerIdentityColor(bus) {
  const busId = String(bus?.id || 'bus');
  let hash = 0;
  for (let index = 0; index < busId.length; index += 1) {
    hash = ((hash * 31) + busId.charCodeAt(index)) >>> 0;
  }
  return BUS_MARKER_IDENTITY_COLORS[hash % BUS_MARKER_IDENTITY_COLORS.length];
}

export const BUS_MARKER_MIN_SIZE = 28;
export const BUS_MARKER_MAX_SIZE = 48;
const BUS_MARKER_BASE_SIZE = 36;
const BUS_MARKER_BASE_ZOOM = 12;
const BUS_MARKER_ZOOM_STEP = 2;
const BUS_MARKER_SELECTED_BONUS = 4;

export function getBusMarkerSize(zoom, isSelected = false) {
  const safeZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : BUS_MARKER_BASE_ZOOM;
  const scaledSize = BUS_MARKER_BASE_SIZE + ((safeZoom - BUS_MARKER_BASE_ZOOM) * BUS_MARKER_ZOOM_STEP) + (isSelected ? BUS_MARKER_SELECTED_BONUS : 0);
  return Math.max(BUS_MARKER_MIN_SIZE, Math.min(BUS_MARKER_MAX_SIZE, Math.round(scaledSize)));
}

export function getBusMarkerHitTargetSize(visibleSize) {
  const safeSize = Number.isFinite(Number(visibleSize)) ? Number(visibleSize) : BUS_MARKER_BASE_SIZE;
  return Math.max(44, Math.round(safeSize + 12));
}

function escapeMarkerLabel(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

export function createBusMarkerIcon(bus, isSelected = false, zoom = BUS_MARKER_BASE_ZOOM, nowMs = Date.now(), fanLabel = '', sharedTail = false) {
  const label = fanLabel || bus?.plateNumber || bus?.busCode || '';
  const size = Math.max(42, Math.min(fanLabel ? 46 : 48, getBusMarkerSize(zoom)));
  // Compact grouped hit areas must not cover the neighboring pin.
  const hitTargetSize = fanLabel ? Math.max(48, size + 4) : getBusMarkerHitTargetSize(size);
  const pointerLength = sharedTail ? 0 : 10;
  const pinHeight = size + pointerLength;
  const hitHeight = pinHeight + 8;
  const middle = size / 2;
  const corner = 12;
  // One continuous outline joins the squircle and tip without a seam.
  const tip = sharedTail ? '' : `H${middle + 7} L${middle} ${pinHeight - 1} L${middle - 7} ${size - 1} `;
  const pinOutline = `M${corner + 1} 1 H${size - corner - 1} Q${size - 1} 1 ${size - 1} ${corner + 1} V${size - corner - 1} Q${size - 1} ${size - 1} ${size - corner - 1} ${size - 1} ${tip}H${corner + 1} Q1 ${size - 1} 1 ${size - corner - 1} V${corner + 1} Q1 1 ${corner + 1} 1 Z`;
  const glyphSize = Math.round(size * 0.58);
  const color = '#0f172a'; // Existing accepted dark bus body, for every GPS state.
  const gpsStatus = getMarkerGpsFreshness(bus, nowMs).status;
  const identityColor = getBusMarkerIdentityColor(bus);
  const statusCue = gpsStatus === 'Online' ? '' : `<span class="centrabus-marker__status-cue" data-status="${gpsStatus}" title="GPS ${gpsStatus}" aria-hidden="true"></span>`;
  return L.divIcon({
    className: 'centrabus-marker',
    html: `
      <div class="centrabus-marker__hit-area${isSelected ? ' is-selected' : ''}" style="width:${hitTargetSize}px;height:${hitHeight}px;--marker-selection-ring:${identityColor}24" aria-hidden="true">
        ${label ? `<span class="centrabus-marker__fan-label" title="${escapeMarkerLabel(label)}"><span class="centrabus-marker__label-text">${escapeMarkerLabel(label)}</span></span>` : ''}
        <div class="centrabus-marker__pin${isSelected ? ' is-selected' : ''}" style="width:${size}px;height:${pinHeight}px">
          <svg class="centrabus-marker__shell" width="${size}" height="${pinHeight}" viewBox="0 0 ${size} ${pinHeight}" aria-hidden="true">
            <path class="${sharedTail ? 'centrabus-marker__outline' : 'centrabus-marker__pointer'}" d="${pinOutline}" fill="${color}" stroke="${identityColor}" stroke-width="2" stroke-linejoin="round"/>
          </svg>
          <div class="centrabus-marker__body${isSelected ? ' is-selected' : ''}" data-gps-status="${gpsStatus}" style="width:${size}px;height:${size}px">
          ${statusCue}
          <svg viewBox="0 0 24 24" width="${glyphSize}" height="${glyphSize}" aria-hidden="true">
            <rect x="5" y="3" width="14" height="16" rx="3" fill="none" stroke="white" stroke-width="2"/>
            <path d="M5 11h14M8 19v2M16 19v2" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <circle cx="8.5" cy="15.5" r="1.2" fill="white"/>
            <circle cx="15.5" cy="15.5" r="1.2" fill="white"/>
          </svg>
          </div>
        </div>
      </div>
    `,
    iconSize: [hitTargetSize, hitHeight],
    // The integrated tip, not the body center, points at the rendered coordinate.
    iconAnchor: [hitTargetSize / 2, hitHeight - 4],
    popupAnchor: [0, -(pinHeight + 6)],
    markerVisibleSize: size,
    markerHitTargetSize: hitTargetSize,
    markerPointerLength: pointerLength,
  });
}

export function createSharedBusMarkerIcon(buses, selectedBusId, zoom = BUS_MARKER_BASE_ZOOM, nowMs = Date.now()) {
  const ordered = [...buses].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const size = Math.max(42, Math.min(46, getBusMarkerSize(zoom)));
  const columns = Math.min(2, ordered.length);
  const rows = Math.ceil(ordered.length / columns);
  const cellWidth = 52;
  const rowStep = size + 28; // Reserve a label lane between rows.
  const width = columns * cellWidth;
  const bodyHeight = size + 8 + (rows - 1) * rowStep;
  const height = bodyHeight + 10;
  const center = width / 2;
  const shell = `M14 1 H${width - 14} Q${width - 1} 1 ${width - 1} 14 V${bodyHeight - 14} Q${width - 1} ${bodyHeight - 1} ${width - 14} ${bodyHeight - 1} H${center + 8} L${center} ${height - 1} L${center - 8} ${bodyHeight - 1} H14 Q1 ${bodyHeight - 1} 1 ${bodyHeight - 14} V14 Q1 1 14 1 Z`;
  const chips = ordered.map((bus, index) => {
    const row = Math.floor(index / columns);
    const rowCount = Math.min(columns, ordered.length - row * columns);
    const left = (width - rowCount * cellWidth) / 2 + (index % columns) * cellWidth;
    const label = (typeof bus.plateNumber === 'string' && bus.plateNumber.trim())
      || (typeof bus.busCode === 'string' && bus.busCode.trim()) || `Bus ${index + 1}`;
    const selected = bus.id === selectedBusId;
    const chip = createBusMarkerIcon(bus, selected, zoom, nowMs, label, true);
    return `<button type="button" class="centrabus-marker-group__chip${selected ? ' is-selected' : ''}" data-bus-id="${escapeMarkerLabel(bus.id)}" aria-label="Select bus ${escapeMarkerLabel(label)}" aria-pressed="${selected}" style="left:${left}px;top:${row * rowStep}px;width:${cellWidth}px;height:${size + 8}px">${chip.options.html}</button>`;
  }).join('');
  return L.divIcon({
    className: 'centrabus-marker centrabus-marker--shared',
    html: `<div class="centrabus-marker-group" style="width:${width}px;height:${height}px"><svg class="centrabus-marker__shell centrabus-marker-group__shell" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path class="centrabus-marker-group__tail" d="${shell}" fill="#0f172a" stroke="#334155" stroke-width="1.5" stroke-linejoin="round"/></svg>${chips}</div>`,
    iconSize: [width, height],
    iconAnchor: [center, height],
    popupAnchor: [0, -height],
    markerVisibleSize: width,
    sharedGroupBusIds: ordered.map((bus) => bus.id),
  });
}

function toRadians(value) { return (value * Math.PI) / 180; }
function projectToMeters(point, origin) {
  const earthRadiusM = 6371000;
  const lat = toRadians(point.lat), lng = toRadians(point.lng);
  const originLat = toRadians(origin.lat), originLng = toRadians(origin.lng);
  return {
    x: (lng - originLng) * Math.cos((lat + originLat) / 2) * earthRadiusM,
    y: (lat - originLat) * earthRadiusM,
  };
}

export const BUS_OVERLAP_DISTANCE_M = 45;
export const BUS_MARKER_NEARBY_DISTANCE_PX = 50;
export const BUS_MARKER_SHARED_ANCHOR_DISTANCE_PX = 10;
export const BUS_MARKER_SHARED_LOCATION_TOLERANCE_M = 3;

function createBusGpsAnchorIcon() {
  return L.divIcon({
    className: 'centrabus-gps-anchor',
    html: '<span class="centrabus-gps-anchor__dot" aria-hidden="true"></span>',
    iconSize: [5, 5],
    iconAnchor: [2.5, 2.5],
  });
}

function getBusScreenPoint(bus, map) {
  const coordinates = getBusCoordinates(bus);
  if (!coordinates || typeof map?.latLngToContainerPoint !== 'function') return null;
  const point = map.latLngToContainerPoint([coordinates.lat, coordinates.lng]);
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
    ? { x: Number(point.x), y: Number(point.y) }
    : null;
}

function sharesBusLocation(left, right) {
  const leftCoordinates = getBusCoordinates(left.bus);
  const rightCoordinates = getBusCoordinates(right.bus);
  const meters = projectToMeters(leftCoordinates, rightCoordinates);
  return Math.hypot(meters.x, meters.y) <= BUS_MARKER_SHARED_LOCATION_TOLERANCE_M
    && Math.hypot(left.point.x - right.point.x, left.point.y - right.point.y) <= BUS_MARKER_SHARED_ANCHOR_DISTANCE_PX;
}

/**
 * Calculate presentation-only pixel offsets for buses whose true positions
 * would otherwise render too close together. Stable bus IDs determine each
 * bus's place in the radial layout, so frequent GPS updates do not swap sides.
 */
export function getNearbyBusMarkerOffsets(buses, map, zoom = BUS_MARKER_BASE_ZOOM) {
  const offsets = new window.Map();
  if (!Array.isArray(buses) || typeof map?.latLngToContainerPoint !== 'function') return offsets;

  const visibleBuses = buses
    .filter(isMarkerEligible)
    .map((bus) => ({ bus, point: getBusScreenPoint(bus, map) }))
    .filter((entry) => entry.point)
    .sort((left, right) => String(left.bus.id).localeCompare(String(right.bus.id)));
  const groups = [];
  const visited = new Set();
  const threshold = BUS_MARKER_NEARBY_DISTANCE_PX;
  // Complete-link groups: neither proximity chains nor distant points at a
  // low zoom may imply that buses share one true GPS location.
  const sharedGroups = [];
  visibleBuses.forEach((entry) => {
    const group = sharedGroups.find((candidate) => candidate.every((other) => sharesBusLocation(entry, other)));
    if (group) group.push(entry);
    else sharedGroups.push([entry]);
  });
  const sharedByBusId = new window.Map();
  sharedGroups.filter((group) => group.length > 1).forEach((group) => {
    const coordinates = getBusCoordinates(group[0].bus);
    const descriptor = {
      key: JSON.stringify(group.map((entry) => entry.bus.id)),
      busIds: group.map((entry) => entry.bus.id),
      position: [coordinates.lat, coordinates.lng],
    };
    group.forEach((entry) => sharedByBusId.set(entry.bus.id, descriptor));
  });

  visibleBuses.forEach((entry, startIndex) => {
    if (visited.has(startIndex)) return;
    const group = [];
    const pending = [startIndex];
    visited.add(startIndex);
    while (pending.length) {
      const currentIndex = pending.pop();
      const current = visibleBuses[currentIndex];
      group.push(current);
      visibleBuses.forEach((candidate, candidateIndex) => {
        if (visited.has(candidateIndex)) return;
        const distance = Math.hypot(candidate.point.x - current.point.x, candidate.point.y - current.point.y);
        if (distance <= threshold) {
          visited.add(candidateIndex);
          pending.push(candidateIndex);
        }
      });
    }
    if (group.length > 1) {
      group.sort((left, right) => String(left.bus.id).localeCompare(String(right.bus.id)));
      groups.push(group);
    }
  });

  const markerHitSize = getBusMarkerHitTargetSize(getBusMarkerSize(zoom, true));
  const minimumSeparation = markerHitSize + 4;
  groups.forEach((group) => {
    // Require the whole group to fit inside the shared-anchor tolerance.
    // A chain of nearby buses must never merge genuinely distinct positions.
    const sharedAnchor = group.every((entry) => group.every((other) => sharesBusLocation(entry, other)));
    const center = sharedAnchor ? group[0].point : group.reduce((sum, entry) => ({
      x: sum.x + entry.point.x / group.length,
      y: sum.y + entry.point.y / group.length,
    }), { x: 0, y: 0 });
    const halfWidth = minimumSeparation / 2;
    const rise = Math.max(44, getBusMarkerSize(zoom, true) + 6);
    const radius = minimumSeparation / (2 * Math.sin(Math.PI / group.length));
    group.forEach((entry, index) => {
      let displacement;
      if (group.length === 2) {
        // The pin body already sits above its tip. Only separate the pair
        // sideways; do not leave a long empty gap above the true GPS dots.
        const compactHalfWidth = Math.max(24, Math.min(26, halfWidth));
        displacement = { x: index === 0 ? -compactHalfWidth : compactHalfWidth, y: 0 };
      } else if (group.length === 3) {
        displacement = [
          // Reserve space above the lower row for its compact bus labels.
          { x: 0, y: -rise - minimumSeparation - 18 },
          { x: -halfWidth, y: -rise },
          { x: halfWidth, y: -rise },
        ][index];
      } else if (group.length === 4) {
        displacement = { x: index % 2 === 0 ? -halfWidth : halfWidth, y: index < 2 ? -rise : rise };
      } else {
        const angle = (-Math.PI / 2) + ((2 * Math.PI * index) / group.length);
        displacement = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      }
      const target = {
        x: center.x + displacement.x,
        y: center.y + displacement.y,
      };
      const plate = typeof entry.bus.plateNumber === 'string' ? entry.bus.plateNumber.trim() : '';
      const busCode = typeof entry.bus.busCode === 'string' ? entry.bus.busCode.trim() : '';
      const sharedGroup = sharedByBusId.get(entry.bus.id);
      offsets.set(entry.bus.id, {
        x: target.x - entry.point.x,
        y: target.y - entry.point.y,
        sharedAnchorPosition: sharedGroup?.position || null,
        sharedGroupKey: sharedGroup?.key || null,
        sharedGroupBusIds: sharedGroup?.busIds || null,
        showAnchor: !sharedGroup,
        label: plate || busCode || `Bus ${index + 1}`,
      });
    });
  });
  return offsets;
}

export function getOffsetBusMarkerPosition(map, position, pixelOffset) {
  if (!position || !pixelOffset || (!pixelOffset.x && !pixelOffset.y)
    || typeof map?.latLngToContainerPoint !== 'function'
    || typeof map?.containerPointToLatLng !== 'function') return position;
  const point = map.latLngToContainerPoint(position);
  if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))) return position;
  const shifted = map.containerPointToLatLng({ x: Number(point.x) + pixelOffset.x, y: Number(point.y) + pixelOffset.y });
  const latitude = Number(shifted?.lat ?? shifted?.[0]);
  const longitude = Number(shifted?.lng ?? shifted?.[1]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : position;
}


export function getOverlappingBuses(bus, buses, maxDistanceM = BUS_OVERLAP_DISTANCE_M, map = null) {
  const origin = getBusCoordinates(bus);
  if (!origin || !Array.isArray(buses)) return [];
  const canMeasureHitOverlap = typeof map?.latLngToContainerPoint === 'function';
  const zoom = canMeasureHitOverlap && Number.isFinite(Number(map.getZoom?.()))
    ? Number(map.getZoom())
    : BUS_MARKER_BASE_ZOOM;
  const originPoint = canMeasureHitOverlap ? map.latLngToContainerPoint([origin.lat, origin.lng]) : null;
  const originHitSize = getBusMarkerHitTargetSize(getBusMarkerSize(zoom, true));

  return buses.filter((candidate) => {
    if (!isMarkerEligible(candidate)) return false;
    const coordinates = getBusCoordinates(candidate);
    if (!coordinates) return false;
    const projected = projectToMeters(coordinates, origin);
    if (Math.hypot(projected.x, projected.y) <= maxDistanceM) return true;
    if (!originPoint) return false;
    const candidatePoint = map.latLngToContainerPoint([coordinates.lat, coordinates.lng]);
    if (!Number.isFinite(Number(candidatePoint?.x)) || !Number.isFinite(Number(candidatePoint?.y))) return false;
    const candidateHitSize = getBusMarkerHitTargetSize(getBusMarkerSize(zoom));
    const overlapReach = (originHitSize + candidateHitSize) / 2;
    return Math.abs(candidatePoint.x - originPoint.x) <= overlapReach
      && Math.abs(candidatePoint.y - originPoint.y) <= overlapReach;
  });
}

// Hide the retired corridor's labels in presentation only. Preserve original
// route assignments and source telemetry for history/backend processing.
export function visibleRouteName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return !name || /^(?:LIMA\s*[-–—→]\s*FPIP|FPIP\s*[-–—→]\s*LIMA)$/i.test(name) ? null : name;
}

export function getTripRoutePoints(trip) {
  if (!trip) return fpipToLimaRoute;
  // Presentation only: reverse operational assignments/history are retained.
  const reverseLabel = /^LIMA\s*[-–—→]\s*FPIP$/i.test(String(trip.routeLabel || '').trim());
  const near = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lng - b.lng) < 0.002;
  const reverseEndpoints = near(trip.originCoordinates, fpipToLimaWaypoints[fpipToLimaWaypoints.length - 1])
    && near(trip.destinationCoordinates, fpipToLimaWaypoints[0]);
  if (reverseLabel || reverseEndpoints) return [];
  return [trip.originCoordinates, trip.destinationCoordinates].filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
}
function getRouteSignature(points) {
  return points.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)).map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join(';');
}
export function useRoadRoute(waypoints) {
  const signature = getRouteSignature(waypoints);
  const [routeState, setRouteState] = useState(() => ({ signature, points: roadRouteCache[signature] || [], status: roadRouteCache[signature] ? 'ready' : 'loading' }));
  useEffect(() => {
    if (!signature || waypoints.length < 2) { setRouteState({ signature, points: [], status: 'empty' }); return; }
    if (roadRouteCache[signature]) { setRouteState({ signature, points: roadRouteCache[signature], status: 'ready' }); return; }
    const controller = new AbortController();
    let cancelled = false;
    const coordinates = waypoints.map((point) => `${point.lng},${point.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
    setRouteState({ signature, points: [], status: 'loading' });
    fetch(url, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) throw new Error('No route');
        const points = data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        roadRouteCache[signature] = points;
        setRouteState({ signature, points, status: 'ready' });
      })
      .catch((err) => { if (!cancelled && err.name !== 'AbortError') setRouteState({ signature, points: [], status: 'error' }); });
    return () => { cancelled = true; controller.abort(); };
  }, [signature]);
  if (routeState.signature !== signature) return { signature, points: roadRouteCache[signature] || [], status: roadRouteCache[signature] ? 'ready' : 'loading' };
  return routeState;
}

/* ─── Shared UI Components ──────────────────────── */

function IconBox({ children, tone = 'blue', size = 'md' }) {
  const colors = {
    blue: 'bg-[#FBEDEE] text-[#7A1F2B] border-[#F3D6D9]',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-[#FFF7DB] text-[#9A6800] border-[#F7E5A7]',
    red: 'bg-[#FBEDEE] text-[#8E1F2F] border-[#F1D1D5]',
    gray: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  const dimension = size === 'lg' ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm';
  return <span className={`grid ${dimension} shrink-0 place-items-center rounded-xl border font-extrabold ${colors[tone]}`}>{children}</span>;
}

function StatusBadge({ value }) {
  return <span className={`rounded-full border px-2.5 py-0.5 text-sm font-semibold ${getStatusBadgeStyle(value)}`}>{value}</span>;
}

export function Header({ currentTime, activePageTitle, activePageSubtitle, alertCount, systemHealth, connectivityStatus, alerts, buses = [], onViewAlert, onToggleSidebar, user }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const notifications = alerts.filter(isUnacknowledgedAlert);
  const connectivityStyles = {
    healthy: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    degraded: 'border-amber-200 bg-amber-50 text-amber-800',
    offline: 'border-slate-300 bg-slate-100 text-slate-700',
    neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  };
  const healthStyles = {
    healthy: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    critical: 'border-red-200 bg-red-50 text-red-800',
    neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  const ConnectivityIcon = connectivityStatus.tone === 'offline' ? WifiOff : Wifi;
  return (
    <header className="relative flex min-h-[72px] flex-wrap items-center justify-between gap-4 rounded-[18px] border border-slate-200/80 bg-white px-5 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onToggleSidebar} aria-label="Toggle sidebar" className="sidebar-toggle-btn"><Menu size={20} /></button>
        <div className="flex flex-col min-w-0">
        <h1 className="text-lg font-extrabold text-slate-900 leading-tight">{activePageTitle}</h1>
        <p className="text-xs font-medium text-slate-500 leading-tight mt-0.5">{activePageSubtitle}</p>
        </div>
      </div>
      <div className="ml-auto flex items-center justify-end gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-right text-xs text-slate-500">
          <div className="font-bold text-slate-800">{currentTime.toLocaleDateString()}</div>
          <div className="font-medium">{currentTime.toLocaleTimeString()}</div>
        </div>
        <div title={systemHealth.latestSignalAt ? formatTimestamp(systemHealth.latestSignalAt) : 'No verified system signal yet'} className={`hidden rounded-xl border px-3 py-1.5 text-xs sm:block ${healthStyles[systemHealth.overall.tone]}`}>
          <div className="font-extrabold">● {systemHealth.overall.label}</div>
          <div className="font-semibold text-slate-700">Latest real signal: {systemHealth.latestSignalAt ? formatHealthAge({ timestampMs: systemHealth.latestSignalAt }, currentTime.getTime()) : 'waiting'}</div>
        </div>
        <div
          title={connectivityStatus.detail}
          className={`hidden h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold md:flex ${connectivityStyles[connectivityStatus.tone]}`}
        >
          <ConnectivityIcon size={16} />
          <span>{connectivityStatus.label}</span>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-label={`${alertCount} active alerts. Open Alert Center`}
          className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#E9C3C8] bg-white text-[#7A1F2B] transition hover:bg-[#FBEDEE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"
        >
          <Bell size={18} />
          {alertCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-extrabold text-white">{alertCount > 99 ? '99+' : alertCount}</span>}
        </button>
        {panelOpen && <div className="absolute right-5 top-20 z-[2100] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#E9C3C8] bg-white p-3 shadow-xl shadow-[#7A1F2B]/10"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-extrabold text-slate-900">Notifications</span><span className="text-xs font-bold text-slate-500">{notifications.length} unacknowledged</span></div>{notifications.length === 0 ? <p className="p-3 text-sm font-medium text-slate-600">No unacknowledged alerts.</p> : <div className="space-y-2">{notifications.map((alert) => { const matchingBus = buses.find((bus) => bus.id === alert.busNumber || bus.id === alert.busId); return <button key={alert.id} onClick={() => { setPanelOpen(false); onViewAlert(alert); }} className="w-full rounded-xl border border-slate-100 p-3 text-left transition hover:bg-[#FFF7DB]"><div className="flex items-center justify-between gap-2"><span className="truncate font-extrabold text-slate-900">{getAlertDisplayTitle(alert)}</span><StatusBadge value={getAlertSeverity(alert)} /></div><div className="mt-1 text-sm font-bold text-slate-700">{matchingBus?.plateNumber || alert.busNumber}</div><div className="mt-1 text-xs font-medium text-slate-600">{getRelativeTime(alert.timestampMs)} · {getAlertStatus(alert)}</div><span className="mt-2 inline-block text-xs font-extrabold text-[#8E1F2F]">View Alert</span></button>; })}</div>}</div>}
        <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-slate-600">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-900 text-xs font-extrabold text-white">{user.email?.slice(0, 2).toUpperCase() || 'AD'}</span>
          <span className="hidden text-left sm:block">
            <span className="block max-w-44 truncate text-sm font-extrabold leading-none">{user.email}</span>
            <span className="mt-1 block text-xs leading-none text-slate-400">Administrator</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function EmptyState({ title, message, compact = false, icon: Icon = Activity }) {
  return (
    <div className={`grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center ${compact ? 'min-h-[150px] p-5' : 'min-h-[170px] p-6'}`}>
      <div>
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-sm">
          <Icon size={18} />
        </div>
        <div className="mt-3 text-base font-bold text-slate-700">{title}</div>
        <div className="mx-auto mt-1 max-w-sm text-sm font-medium leading-5 text-slate-500">{message}</div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-base font-bold leading-tight text-slate-800">{value}</div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors ${checked ? 'bg-[#A1262F]' : 'bg-slate-300'}`}
    >
      <span className={`pointer-events-none absolute left-0.5 h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

/* ─── Summary Cards ─────────────────────────────── */

function supabaseBusRowToBus(row = {}) {
  return {
    id: row.bus_id,
    plateNumber: row.plate_number ?? null,
    status: row.status ?? 'inactive',
    isPlaceholder: row.is_placeholder === true,
    isArchived: row.is_archived === true,
    routeId: row.route_id ?? null,
    routeName: row.metadata?.routeName ?? null,
    metadata: row.metadata || {},
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function useLiveBuses() {
  const [state, setState] = useState({ status: 'loading', buses: [] });

  useEffect(() => {
    let cancelled = false;
    const changedDuringRead = new Set();
    let reading = false;
    let readAgain = false;
    let previousStatus = 'PENDING';
    let readController = null;
    let readTimeout = null;

    const loadBuses = async () => {
      if (cancelled) return;
      if (reading) { readAgain = true; return; }
      reading = true;
      changedDuringRead.clear();
      readController = new AbortController();
      readTimeout = setTimeout(() => readController?.abort(), 5000);
      try {
      const query = supabase
        .from('buses')
        .select('*')
        .eq('is_placeholder', false)
        .eq('is_archived', false)
        .order('bus_id');
      const { data, error } = await (query.abortSignal ? query.abortSignal(readController.signal) : query);

      if (cancelled) return;

      if (error) {
        console.error('Unable to load Supabase buses:', error.code || 'read-failed');
        setState((current) => ({ ...current, status: 'error' }));
        return;
      }

      const touched = new Set(changedDuringRead);
      setState((current) => {
        const next = new window.Map((data || []).map((row) => [row.bus_id, supabaseBusRowToBus(row)]));
        touched.forEach((id) => {
          const existing = current.buses.find((bus) => bus.id === id);
          if (existing) next.set(id, existing);
          else next.delete(id);
        });
        return { status: 'ready', buses: [...next.values()].sort((a, b) => a.id.localeCompare(b.id)) };
      });
      } catch {
        if (!cancelled) setState((current) => ({ ...current, status: 'error' }));
      } finally {
        clearTimeout(readTimeout);
        readTimeout = null;
        readController = null;
        reading = false;
        if (readAgain && !cancelled) { readAgain = false; void loadBuses(); }
      }
    };

    loadBuses();

    const channel = supabase
      .channel('buses-dashboard')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'buses',
        },
        (payload) => {
          if (cancelled) return;

          if (payload.eventType === 'DELETE') {
            const deletedBusId = payload.old?.bus_id;
            if (!deletedBusId) return;
            changedDuringRead.add(deletedBusId);

            setState((current) => ({
              ...current,
              buses: current.buses.filter((bus) => bus.id !== deletedBusId),
            }));
            return;
          }

          const nextBus = supabaseBusRowToBus(payload.new);

          if (!nextBus.id) return;
          changedDuringRead.add(nextBus.id);

          setState((current) => {
            if (nextBus.isPlaceholder || nextBus.isArchived) {
              return {
                status: 'ready',
                buses: current.buses.filter((bus) => bus.id !== nextBus.id),
              };
            }

            const byId = new window.Map(
              current.buses.map((bus) => [bus.id, bus]),
            );

            byId.set(nextBus.id, nextBus);

            return {
              status: 'ready',
              buses: [...byId.values()].sort((a, b) =>
                a.id.localeCompare(b.id)
              ),
            };
          });
        },
      )
      .subscribe((status, error) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED' && previousStatus !== 'SUBSCRIBED') void loadBuses();
        previousStatus = status;
        if (status === 'CHANNEL_ERROR') {
          console.error(
            'Unable to subscribe to Supabase buses realtime:',
            error?.message || error || status,
          );
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(readTimeout);
      readController?.abort();
      supabase.removeChannel(channel);
    };
  }, []);

  return state;
}

// Normalized Supabase live GPS record:
// { latitude, longitude, speed, online: true, updatedAt, gpsUpdatedAt, deviceUpdatedAt, routeStatus, distanceFromRouteM }
// The dashboard only consumes these values; it does not write GPS packets.
export function normalizeLiveGpsRecord(record = {}) {
  const {
    latitude,
    longitude,
    liveLatitude,
    liveLongitude,
    online,
    updatedAt,
    gpsUpdatedAt,
    deviceUpdatedAt,
    routeStatus,
    distanceFromRouteM,
    rawSpeedKmh,
    filterState,
    gpsQuality,
    consistency,
    horizontalAccuracyM,
    satellitesUsed,
    gpsDriftM,
    windowMovementM,
    movement2sM,
    movement4sM,
    movement6sM,
    movementChecks,
    startChecks,
    recoveryChecks,
  } = record || {};

  return {
    ...(typeof record?.deviceId === 'string' && record.deviceId ? { deviceId: record.deviceId } : {}),
    latitude,
    longitude,
    liveLatitude,
    liveLongitude,
    speed: rawGpsSpeed(record),
    online,
    updatedAt,
    gpsUpdatedAt,
    deviceUpdatedAt,
    routeStatus,
    distanceFromRouteM,
    rawSpeedKmh,
    motionStatus: rawGpsMotion(record),
    filterState,
    gpsQuality,
    consistency,
    horizontalAccuracyM,
    satellitesUsed,
    gpsDriftM,
    windowMovementM,
    movement2sM,
    movement4sM,
    movement6sM,
    movementChecks,
    startChecks,
    recoveryChecks,
  };
}

function supabaseLivePositionRowToGpsRecord(row = {}) {
  const diagnostics = row?.diagnostics && typeof row.diagnostics === 'object'
    ? row.diagnostics
    : {};

  return {
    ...(typeof row?.device_id === 'string' && row.device_id ? { deviceId: row.device_id } : {}),
    latitude: row?.latitude,
    longitude: row?.longitude,
    liveLatitude: row?.live_latitude,
    liveLongitude: row?.live_longitude,
    speed: row?.speed,
    online: row?.online,
    // Database/heartbeat receipt time is never a substitute for capture time.
    updatedAt: row?.gps_updated_at ?? null,
    gpsUpdatedAt: row?.gps_updated_at ?? null,
    deviceUpdatedAt: row?.device_updated_at ?? row?.updated_at,
    routeStatus: row?.route_status,
    distanceFromRouteM: row?.distance_from_route_m,
    rawSpeedKmh: diagnostics?.raw_speed_kmh ?? diagnostics?.rawSpeedKmh,
    motionStatus: diagnostics?.motion_status ?? diagnostics?.motionStatus,
    filterState: diagnostics?.filter_state ?? diagnostics?.filterState,
    gpsQuality: diagnostics?.gps_quality ?? diagnostics?.gpsQuality,
    consistency: diagnostics?.consistency,
    horizontalAccuracyM: diagnostics?.horizontal_accuracy_m ?? diagnostics?.horizontalAccuracyM,
    satellitesUsed: diagnostics?.satellites_used ?? diagnostics?.satellitesUsed,
    gpsDriftM: diagnostics?.gps_drift_m ?? diagnostics?.gpsDriftM,
    windowMovementM: diagnostics?.window_movement_m ?? diagnostics?.windowMovementM,
    movement2sM: diagnostics?.movement_2s_m ?? diagnostics?.movement2sM,
    movement4sM: diagnostics?.movement_4s_m ?? diagnostics?.movement4sM,
    movement6sM: diagnostics?.movement_6s_m ?? diagnostics?.movement6sM,
    movementChecks: diagnostics?.movement_checks ?? diagnostics?.movementChecks,
    startChecks: diagnostics?.start_checks ?? diagnostics?.startChecks,
    recoveryChecks: diagnostics?.recovery_checks ?? diagnostics?.recoveryChecks,
  };
}

export function normalizePersistedGpsRecord(record = {}) {
  const timestamp = record?.gpsUpdatedAt ?? record?.updatedAt ?? record?.receivedAt;
  return normalizeLiveGpsRecord({
    ...record,
    updatedAt: record?.updatedAt ?? timestamp,
    gpsUpdatedAt: record?.gpsUpdatedAt ?? timestamp,
  });
}

function supabaseHistoryRowToGpsRecord(row = {}) {
  const diagnostics = row?.diagnostics && typeof row.diagnostics === 'object'
    ? row.diagnostics
    : {};
  const timestamp = row?.captured_at ?? row?.received_at ?? row?.created_at;

  return {
    latitude: row?.latitude,
    longitude: row?.longitude,
    liveLatitude: row?.live_latitude,
    liveLongitude: row?.live_longitude,
    speed: row?.speed,
    online: row?.online,
    updatedAt: timestamp,
    gpsUpdatedAt: timestamp,
    deviceUpdatedAt: row?.received_at ?? timestamp,
    receivedAt: row?.received_at,
    routeStatus: row?.route_status,
    distanceFromRouteM: row?.distance_from_route_m,
    rawSpeedKmh: diagnostics?.raw_speed_kmh ?? diagnostics?.rawSpeedKmh,
    motionStatus: diagnostics?.motion_status ?? diagnostics?.motionStatus,
    filterState: diagnostics?.filter_state ?? diagnostics?.filterState,
    gpsQuality: diagnostics?.gps_quality ?? diagnostics?.gpsQuality,
    consistency: diagnostics?.consistency,
    horizontalAccuracyM: diagnostics?.horizontal_accuracy_m ?? diagnostics?.horizontalAccuracyM,
    satellitesUsed: diagnostics?.satellites_used ?? diagnostics?.satellitesUsed,
    gpsDriftM: diagnostics?.gps_drift_m ?? diagnostics?.gpsDriftM,
    windowMovementM: diagnostics?.window_movement_m ?? diagnostics?.windowMovementM,
    movement2sM: diagnostics?.movement_2s_m ?? diagnostics?.movement2sM,
    movement4sM: diagnostics?.movement_4s_m ?? diagnostics?.movement4sM,
    movement6sM: diagnostics?.movement_6s_m ?? diagnostics?.movement6sM,
    movementChecks: diagnostics?.movement_checks ?? diagnostics?.movementChecks,
    startChecks: diagnostics?.start_checks ?? diagnostics?.startChecks,
    recoveryChecks: diagnostics?.recovery_checks ?? diagnostics?.recoveryChecks,
  };
}

export const GPS_ACTIVITY_HISTORY_LIMIT = 300;
export const GPS_ACTIVITY_RECORD_LIMIT = 500;

function getLiveGpsSampleKey(gps) {
  return [
    getGpsSampleTimestamp(gps),
    gps?.latitude,
    gps?.longitude,
    gps?.rawSpeedKmh,
    gps?.online,
  ].join('|');
}

export function appendLiveGpsHistory(historyByBusId = {}, normalizedGps = {}) {
  const nextHistory = { ...historyByBusId };
  Object.entries(normalizedGps).forEach(([busId, gps]) => {
    const timestampMs = getGpsSampleTimestamp(gps);
    if (!Number.isFinite(timestampMs) || gps.sourceUnavailable) return;
    const previousSamples = Array.isArray(nextHistory[busId]) ? nextHistory[busId] : [];
    const sampleKey = getLiveGpsSampleKey(gps);
    if (previousSamples.some((sample) => getLiveGpsSampleKey(sample) === sampleKey)) return;
    nextHistory[busId] = [...previousSamples, gps].slice(-GPS_ACTIVITY_HISTORY_LIMIT);
  });
  return nextHistory;
}

export function mergeLiveGpsHistory(historyByBusId = {}, incomingHistoryByBusId = {}) {
  const nextHistory = { ...historyByBusId };
  Object.entries(incomingHistoryByBusId || {}).forEach(([busId, incomingSamples]) => {
    if (!Array.isArray(incomingSamples)) return;
    const existingSamples = Array.isArray(nextHistory[busId]) ? nextHistory[busId] : [];
    const samplesByKey = new window.Map();
    [...existingSamples, ...incomingSamples].forEach((sample) => {
      if (!sample || !Number.isFinite(getGpsSampleTimestamp(sample))) return;
      samplesByKey.set(getLiveGpsSampleKey(sample), sample);
    });
    nextHistory[busId] = [...samplesByKey.values()]
      .sort((left, right) => getGpsSampleTimestamp(left) - getGpsSampleTimestamp(right))
      .slice(-GPS_ACTIVITY_HISTORY_LIMIT);
  });
  return nextHistory;
}

function formatLiveGpsCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : 'Unavailable';
}

function formatLiveGpsSpeed(value) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} km/h` : 'Unavailable';
}

export function buildLiveGpsActivityRecords(buses = [], historyByBusId = {}, nowMs = Date.now()) {
  const busById = new window.Map(buses.map((bus) => [bus.id, bus]));
  const records = [];

  Object.entries(historyByBusId || {}).forEach(([busId, samples]) => {
    const bus = busById.get(busId);
    if (!bus || bus.isArchived === true || !Array.isArray(samples)) return;

    samples.forEach((gps, sampleIndex) => {
      const timestampMs = getGpsSampleTimestamp(gps);
    if (!Number.isFinite(timestampMs) || gps.sourceUnavailable) return;
      const freshness = getGpsFreshness({ gps }, nowMs);
      const latitude = Number(gps.latitude);
      const longitude = Number(gps.longitude);
      const speed = rawGpsSpeed(gps);
      const coordinates = `${formatLiveGpsCoordinate(latitude)}, ${formatLiveGpsCoordinate(longitude)}`;
      records.push({
        id: `gps-record-${busId}-${timestampMs}-${sampleIndex}`,
        timestampMs,
        busId,
        busNumber: busId,
        category: 'GPS',
        event: `GPS fix · ${coordinates} · ${formatLiveGpsSpeed(speed)}`,
        eventResult: freshness.status,
        operationalState: getBusStatusLabel(bus.status),
        sync: 'Synced',
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        speed: Number.isFinite(speed) ? speed : null,
        online: gps.online === true,
        gpsStatus: freshness.status,
        routeStatus: gps.routeStatus || '',
        distanceFromRouteM: Number.isFinite(Number(gps.distanceFromRouteM)) ? Number(gps.distanceFromRouteM) : null,
        rawSpeedKmh: Number.isFinite(Number(gps.rawSpeedKmh)) ? Number(gps.rawSpeedKmh) : null,
        gpsQuality: gps.gpsQuality || '',
        motionStatus: rawGpsMotion(gps),
        filterState: gps.filterState || '',
      });
    });
  });

  return records
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, GPS_ACTIVITY_RECORD_LIMIT);
}

export function mergeOrderedGps(previous, incoming) {
  if (!previous) return retainLastKnownPosition(previous, incoming);
  const previousCapture = getGpsSampleTimestamp(previous);
  const incomingCapture = getGpsSampleTimestamp(incoming);
  const deviceUpdatedAt = getGpsSampleTimestamp({ gpsUpdatedAt: incoming.deviceUpdatedAt }) > getGpsSampleTimestamp({ gpsUpdatedAt: previous.deviceUpdatedAt })
    ? incoming.deviceUpdatedAt : previous.deviceUpdatedAt;
  // Heartbeats share this table but must not replace a GPS fix, route status,
  // or source age. A duplicate/late event can only advance device liveness.
  if (previousCapture && (!incomingCapture || incomingCapture <= previousCapture)) {
    return deviceUpdatedAt === previous.deviceUpdatedAt ? previous : { ...previous, deviceUpdatedAt };
  }
  return retainLastKnownPosition(previous, { ...incoming, deviceUpdatedAt });
}

function unavailableLastKnownGps(gps) {
  if (!gps?.lastKnownPosition && !getBusCoordinates({ gps })) return null;
  return { ...retainLastKnownPosition(gps, gps), online: false, sourceUnavailable: true };
}

export function useLiveGps(registeredBusIds = null) {
  const [state, setState] = useState({
    gpsByBusId: {}, lastSnapshotAt: null,
    realtime: { channelStatus: 'PENDING', changedAt: null, readStatus: 'PENDING', lastEventAt: null },
  });
  useEffect(() => {
    let cancelled = false;
    // A delayed initial SELECT must not replace positions/deletes already received.
    const changedDuringRead = new Set();
    let reading = false;
    let readAgain = false;
    let previousChannelStatus = 'PENDING';
    let readController = null;
    let readTimeout = null;
    let retryTimer = null;
    let retryCount = 0;

    // A replacement effect/channel (including Strict Mode) starts pending;
    // never carry a previous channel's subscribed state into the new lifecycle.
    setState((current) => ({
      ...current,
      realtime: { channelStatus: 'PENDING', changedAt: null, readStatus: 'PENDING', lastEventAt: null },
    }));

    const loadLivePositions = async () => {
      if (cancelled) return;
      if (reading) { readAgain = true; return; }
      clearTimeout(retryTimer);
      reading = true;
      changedDuringRead.clear();
      readController = new AbortController();
      readTimeout = setTimeout(() => readController?.abort(), 5000);
      recordGpsLatency('reconciliation-start');
      try {
      const query = supabase
        .from('live_bus_positions')
        .select('*');
      const { data, error } = await (query.abortSignal ? query.abortSignal(readController.signal) : query);

      if (error) throw error;
      if (cancelled) return;
      const touched = new Set(changedDuringRead);

      const normalizedGps = Object.fromEntries(
        (data || []).map((row) => [
          row.bus_id,
          normalizeLiveGpsRecord(supabaseLivePositionRowToGpsRecord(row)),
        ]),
      );

      setState((current) => {
        const nextGps = Object.fromEntries(Object.entries(normalizedGps).map(([id, gps]) => [
          id, mergeOrderedGps(current.gpsByBusId[id], gps),
        ]));
        Object.entries(current.gpsByBusId).forEach(([id, gps]) => {
          if (!(id in normalizedGps)) {
            const retained = unavailableLastKnownGps(gps);
            if (retained) nextGps[id] = retained;
          }
        });
        touched.forEach((id) => {
          if (current.gpsByBusId[id]) nextGps[id] = current.gpsByBusId[id];
          else delete nextGps[id];
        });
        return {
          ...current,
          gpsByBusId: nextGps,
          lastSnapshotAt: Date.now(),
          realtime: { ...current.realtime, readStatus: 'READY' },
        };
      });
      retryCount = 0;
      recordGpsLatency('reconciliation-completed');
      } catch (error) {
      if (cancelled) return;
      console.error('Unable to load Supabase live GPS:', error.code || 'read-failed');
      recordGpsLatency('reconciliation-failed');
      setState((current) => ({
        ...current,
        realtime: { ...current.realtime, readStatus: 'ERROR' },
      }));
      if (retryCount < 3 && !readAgain) {
        retryTimer = setTimeout(() => void loadLivePositions(), [1000, 3000, 10000][retryCount++]);
      }
      } finally {
        clearTimeout(readTimeout);
        readTimeout = null;
        readController = null;
        reading = false;
        if (readAgain && !cancelled) { readAgain = false; void loadLivePositions(); }
      }
    };

    void loadLivePositions();

    const channel = supabase
      .channel('live-bus-positions-dashboard')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_bus_positions',
        },
        (payload) => {
          if (cancelled) return;
          const receivedAt = Date.now();
          if (payload.eventType === 'DELETE') {
            const busId = payload.old?.bus_id;
            if (!busId) return;
            changedDuringRead.add(busId);

            setState((current) => {
              const nextGpsByBusId = { ...current.gpsByBusId };
              const retained = unavailableLastKnownGps(nextGpsByBusId[busId]);
              if (retained) nextGpsByBusId[busId] = retained;
              else delete nextGpsByBusId[busId];

              return {
                ...current,
                gpsByBusId: nextGpsByBusId,
                lastSnapshotAt: receivedAt,
                realtime: { ...current.realtime, lastEventAt: receivedAt },
              };
            });
            return;
          }

          const busId = payload.new?.bus_id;
          if (!busId) return;
          changedDuringRead.add(busId);

          const gps = normalizeLiveGpsRecord(
            supabaseLivePositionRowToGpsRecord(payload.new),
          );
          recordGpsLatency('frontend-received', { busId, capturedAt: getGpsSampleTimestamp(gps), backendReceivedAt: getGpsSampleTimestamp({ gpsUpdatedAt: gps.deviceUpdatedAt }) });

          setState((current) => ({
            ...current,
            gpsByBusId: {
              ...current.gpsByBusId,
              [busId]: mergeOrderedGps(current.gpsByBusId[busId], gps),
            },
            lastSnapshotAt: receivedAt,
            realtime: { ...current.realtime, lastEventAt: receivedAt },
          }));
        },
      )
      .subscribe((status, error) => {
        if (cancelled) return;
        const channelStatus = error && !['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)
          ? 'CHANNEL_ERROR' : status;
        // One coalesced catch-up SELECT after joining/rejoining the existing
        // channel. No polling, event refetch loop, or additional subscription.
        if (channelStatus === 'SUBSCRIBED' && previousChannelStatus !== 'SUBSCRIBED') {
          retryCount = 0;
          void loadLivePositions();
        }
        previousChannelStatus = channelStatus;
        recordGpsLatency(`realtime-${channelStatus.toLowerCase()}`);
        setState((current) => ({
          ...current,
          realtime: {
            ...current.realtime,
            channelStatus,
            changedAt: current.realtime.channelStatus === channelStatus
              ? current.realtime.changedAt : Date.now(),
          },
        }));
        if (error) {
          console.error('Supabase live GPS realtime error:', error.code || channelStatus);
        }
      });

    const catchUp = () => {
      if (document.visibilityState === 'hidden') return;
      retryCount = 0;
      void loadLivePositions();
    };
    window.addEventListener('online', catchUp);
    document.addEventListener('visibilitychange', catchUp);

    return () => {
      cancelled = true;
      clearTimeout(readTimeout);
      clearTimeout(retryTimer);
      window.removeEventListener('online', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
      readController?.abort();
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!registeredBusIds) return;
    const ids = new Set(registeredBusIds);
    setState((current) => {
      if (Object.keys(current.gpsByBusId).every((id) => ids.has(id))) return current;
      return { ...current, gpsByBusId: Object.fromEntries(Object.entries(current.gpsByBusId).filter(([id]) => ids.has(id))) };
    });
  }, [registeredBusIds, state.gpsByBusId]);
  return state;
}

function useBackendHealth() {
  const [state, setState] = useState({
    configured: BACKEND_CONFIG.configured,
    data: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    hasAttempted: false,
  });
  const inFlight = useRef(false);

  useEffect(() => {
    if (!BACKEND_CONFIG.configured) return undefined;
    let active = true;
    let activeController = null;

    const poll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetch(BACKEND_CONFIG.healthUrl, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('health-request-failed');
        const data = await response.json();
        if (data?.ok !== true) throw new Error('invalid-health-response');
        if (active) {
          setState({
            configured: true,
            data: {
              serverTime: toPositiveTimestamp(data.serverTime),
              lastPacketReceivedAt: toPositiveTimestamp(data.lastPacketReceivedAt),
              lastFreshTelemetryAt: toPositiveTimestamp(
                data.lastFreshTelemetryAt ?? data.lastTelemetryReceivedAt,
              ),
              lastTelemetryReceivedAt: toPositiveTimestamp(data.lastTelemetryReceivedAt),
            },
            lastSuccessAt: Date.now(),
            consecutiveFailures: 0,
            hasAttempted: true,
          });
        }
      } catch {
        if (active) setState((current) => ({ ...current, consecutiveFailures: current.consecutiveFailures + 1, hasAttempted: true }));
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        inFlight.current = false;
      }
    };

    void poll();
    const interval = setInterval(poll, SYSTEM_HEALTH_THRESHOLDS.backendPollMs);
    return () => {
      active = false;
      clearInterval(interval);
      activeController?.abort();
      inFlight.current = false;
    };
  }, []);

  return state;
}

function useGpsFreshnessClock() {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

  return nowMs;
}

function formatHealthAge(signal, nowMs) {
  if (!Number.isFinite(signal?.timestampMs)) return 'No recent timestamp';
  const ageSeconds = Math.max(0, Math.floor((nowMs - signal.timestampMs) / 1000));
  if (ageSeconds < 1) return 'just now';
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  return `${ageMinutes}m ago`;
}

function getHealthTone(status) {
  if (['LIVE', 'ONLINE'].includes(status)) return 'healthy';
  if (['STALE', 'DELAYED', 'DEGRADED'].includes(status)) return 'warning';
  if (['NO DATA', 'OFFLINE', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) return 'critical';
  return 'neutral';
}

function useHealthTransitionDiagnostics(systemHealth) {
  const previousStatuses = useRef({});

  useEffect(() => {
    const currentStatuses = {
      GPS: systemHealth.gps.status,
      Pi: systemHealth.raspberryPi.status,
      Backend: systemHealth.backend.status,
      Realtime: systemHealth.realtime.status,
    };
    Object.entries(currentStatuses).forEach(([label, status]) => {
      const previous = previousStatuses.current[label];
      if (previous && previous !== status) console.info(`[System Health] ${label} ${previous} -> ${status}`);
    });
    previousStatuses.current = currentStatuses;
  }, [systemHealth.gps.status, systemHealth.raspberryPi.status, systemHealth.backend.status, systemHealth.realtime.status]);
}

export function SystemHealthCard({ health, nowMs }) {
  const rows = [
    ['GPS Data', health.gps],
    ['GPS Device Activity', health.raspberryPi],
    ['Backend', health.backend],
    ['Supabase Realtime', health.realtime],
  ];
  const toneClasses = {
    healthy: { dot: 'bg-emerald-500', text: 'text-emerald-700', panel: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    warning: { dot: 'bg-amber-500', text: 'text-amber-700', panel: 'border-amber-200 bg-amber-50 text-amber-800' },
    critical: { dot: 'bg-red-500', text: 'text-red-700', panel: 'border-red-200 bg-red-50 text-red-800' },
    neutral: { dot: 'bg-slate-400', text: 'text-slate-600', panel: 'border-slate-200 bg-slate-50 text-slate-700' },
  };

  return (
    <section aria-label="System Health" className="rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Monitor size={17} className="text-slate-500" />
        <h2 className="text-[13px] font-extrabold uppercase tracking-[0.08em] text-slate-700">System Health</h2>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map(([label, signal]) => {
          const styles = toneClasses[getHealthTone(signal.status)];
          return (
            <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 first:pt-0">
              <span className="text-xs font-bold text-slate-600" title={label === 'Supabase Realtime'
                ? 'Live GPS channel subscription only; not GPS freshness, backend health or database-wide/RLS health.'
                : label === 'GPS Device Activity'
                  ? 'Aggregate: latest packet from any authenticated GPS device. ONLINE does not confirm that every bus device is online.'
                  : undefined}>{label}</span>
              <span className={`inline-flex items-center justify-end gap-1.5 text-xs font-extrabold ${styles.text}`}><span className={`h-2 w-2 rounded-full ${styles.dot}`} />{signal.status}</span>
              <span className="col-span-2 text-right text-[11px] font-medium text-slate-400">{label === 'Supabase Realtime'
                ? `Live GPS channel · ${signal.channelStatus}${signal.timestampMs ? ` · state changed ${formatHealthAge(signal, nowMs)}` : ''}${signal.readStatus === 'ERROR' ? ' · initial read failed' : ''}`
                : label === 'GPS Device Activity'
                  ? `Latest packet from any device · ${formatHealthAge(signal, nowMs)}`
                  : signal.detail || formatHealthAge(signal, nowMs)}</span>
            </div>
          );
        })}
      </div>
      <div className={`mt-3 rounded-xl border px-3 py-2.5 ${toneClasses[health.overall.tone].panel}`}>
        <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] opacity-75">Overall</div>
        <div className="mt-0.5 flex items-center gap-2 text-sm font-extrabold"><span className={`h-2.5 w-2.5 rounded-full ${toneClasses[health.overall.tone].dot}`} />{health.overall.label}</div>
      </div>
    </section>
  );
}

export function SummaryCards({ counts, busesLoading, onNavigate }) {
  const { activeBusCount, vehicleIssueCount, warningIssueCount, criticalIssueCount, activeRouteDeviationCount } = counts;
  const conditionDataAvailableBusCount = counts.conditionDataAvailableBusCount;
  const conditionDataAwaitingBusCount = counts.conditionDataAwaitingBusCount || 0;
  const hasNoConditionData = !busesLoading && conditionDataAwaitingBusCount > 0 && conditionDataAvailableBusCount === 0;
  const hasPendingConditionData = !busesLoading && conditionDataAwaitingBusCount > 0;
  const conditionTone = busesLoading ? 'blue' : criticalIssueCount > 0 ? 'red' : warningIssueCount > 0 ? 'amber' : (hasNoConditionData || hasPendingConditionData) ? 'gray' : 'green';
  const routeTone = busesLoading ? 'blue' : activeRouteDeviationCount > 0 ? 'red' : 'green';
  const displayCount = (count) => busesLoading ? '—' : count.toString();
  const issueBreakdown = [
    criticalIssueCount > 0 ? `${criticalIssueCount} critical` : null,
    warningIssueCount > 0 ? `${warningIssueCount} ${warningIssueCount === 1 ? 'warning' : 'warnings'}` : null,
    vehicleIssueCount === 0
      ? hasNoConditionData
        ? 'Awaiting validated condition data'
        : hasPendingConditionData
          ? 'No active issues in available readings'
          : 'No active issues'
      : null,
  ].filter(Boolean).join(' · ');
  const breakdown = !busesLoading && (
    <div className="summary-card-detail mt-2 text-xs font-semibold" title={issueBreakdown}>
      {criticalIssueCount > 0 && <span className="text-red-700">{criticalIssueCount} critical</span>}
      {criticalIssueCount > 0 && warningIssueCount > 0 && <span className="text-slate-400"> · </span>}
      {warningIssueCount > 0 && <span className="text-amber-700">{warningIssueCount} {warningIssueCount === 1 ? 'warning' : 'warnings'}</span>}
      {vehicleIssueCount === 0 && <span className="text-slate-500">{hasNoConditionData ? 'Awaiting validated condition data' : hasPendingConditionData ? 'No active issues in available readings' : 'No active issues'}</span>}
    </div>
  );

  const cards = [
    { label: 'Active Buses', value: displayCount(activeBusCount), Icon: BusFront, tone: 'blue', action: () => onNavigate({ page: 'map', status: 'online', tripStatus: undefined }) },
    { label: !busesLoading && vehicleIssueCount === 1 ? 'Vehicle Issue' : 'Vehicle Issues', value: displayCount(vehicleIssueCount), detail: breakdown, Icon: Activity, tone: conditionTone, action: () => onNavigate({ page: 'alerts', category: 'Vehicle Condition', status: 'active' }) },
    { label: !busesLoading && activeRouteDeviationCount === 1 ? 'Route Deviation' : 'Route Deviations', value: displayCount(activeRouteDeviationCount), Icon: Route, tone: routeTone, action: () => onNavigate({ page: 'alerts', category: 'route', status: 'active' }) },
  ];

  return (
    <section aria-label="Overview summary" data-testid="overview-kpi-summary" className="dashboard-summary summary-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(({ label, value, detail, Icon, tone, action }, index) => (
        <button
          type="button"
          key={label}
          onClick={action}
          className={`summary-card summary-card-${index + 1} min-h-[88px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md text-left active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]`}
        >
          <div className="summary-card-header flex w-full items-start justify-between gap-4">
            <div className="summary-card-content min-w-0">
              <div className="summary-card-number text-[24px] font-extrabold leading-none text-slate-900">{value}</div>
              <div className="summary-card-title mt-2 text-[13px] font-bold text-slate-700" title={label}>{label}</div>
              {detail}
            </div>
            <span className="summary-card-icon"><IconBox tone={tone}><Icon size={18} strokeWidth={2.2} /></IconBox></span>
          </div>
        </button>
      ))}
    </section>
  );
}

/* ─── Active Bus Summary ───────────────────────── */

function ActiveBusSummary({ bus, onNavigate, nowMs, onClose }) {
  const coordinates = getBusCoordinates(bus);
  const gpsFreshness = getGpsFreshness(bus, nowMs);
  const liveSpeed = rawGpsSpeed(bus?.gps);

  return (
    <section className="flex min-h-0 w-full min-w-0 flex-col rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-extrabold text-slate-900">Active Bus</h2>
        </div>
        <button aria-label="Close vehicle details" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"><X size={18} /></button>
      </div>
      {!bus ? (
        <EmptyState compact icon={BusFront} title="No registered buses yet." message="Register a bus to add it to the live fleet." />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="min-w-0">
              <div className="truncate text-base font-extrabold text-slate-900">{bus.plateNumber || 'No plate assigned'}</div>
              <div className="mt-1 truncate text-xs font-medium text-slate-500">Bus ID: {bus.id}</div>
            </div>
            <div title="Operational bus status is independent of GPS freshness"><div className="mb-1 text-[10px] text-slate-500">Bus record</div><BusStatusBadge status={bus.status} /></div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            {visibleRouteName(bus.routeName) && <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Route</div><div className="mt-1 font-bold text-slate-700">{visibleRouteName(bus.routeName)}</div></div>}
            <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Location</div><div className="mt-1 font-bold text-slate-700">{coordinates ? `${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}` : 'Unavailable'}</div></div>
            <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Speed</div><div className="mt-1 font-bold text-slate-700">{Number.isFinite(liveSpeed) ? `${liveSpeed} km/h` : 'Unavailable'}</div><div className="text-[11px] text-slate-500">Raw GPS · Motion at fix: {rawGpsMotion(bus.gps)}</div></div>
            <div title={formatGpsLastUpdate(gpsFreshness)}><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">GPS</div><div className="mt-1 font-bold text-slate-700">{coordinates ? `${gpsFreshness.status} · ${formatCompactGpsAge(gpsFreshness.ageMs)}` : 'No GPS Data'}</div></div>
          </div>
          <RouteMonitoringSection gps={bus.gps} nowMs={nowMs} />
          <button onClick={() => onNavigate('vehicle-condition')} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-slate-600 transition hover:text-[#8E1F2F]">View bus details <ArrowRight size={15} /></button>
        </>
      )}
    </section>
  );
}


function toFiniteGpsNumber(value) {
  if (value == null || value === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatGpsDiagnosticValue(value, digits = 2, suffix = '') {
  const numericValue = toFiniteGpsNumber(value);
  return numericValue == null ? 'Unavailable' : `${numericValue.toFixed(digits)}${suffix}`;
}

function getGpsDiagnosticPillClass(kind, value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (kind === 'motion') {
    if (normalized === 'MOVING') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (normalized === 'STOPPED') return 'border-slate-200 bg-slate-50 text-slate-700';
  }
  if (kind === 'quality') {
    if (normalized === 'GOOD') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (normalized === 'WEAK') return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (kind === 'consistency') {
    if (normalized === 'OK') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (normalized === 'BAD') return 'border-red-200 bg-red-50 text-red-700';
  }
  if (kind === 'filter') {
    if (normalized === 'MOVING') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (normalized === 'STARTING' || normalized === 'STOPPING' || normalized === 'RECOVERING') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (normalized === 'STATIONARY') return 'border-sky-200 bg-sky-50 text-sky-700';
    if (normalized === 'CALIBRATING') return 'border-violet-200 bg-violet-50 text-violet-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function GpsDiagnosticPill({ kind, value }) {
  const label = value || 'Unavailable';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-extrabold ${getGpsDiagnosticPillClass(kind, value)}`}>{label}</span>;
}

function GpsMetricCard({ label, value, helper }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/75 p-3">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm font-extrabold text-slate-800">{value}</div>
      {helper && <div className="mt-1 text-[10px] font-semibold leading-4 text-slate-400">{helper}</div>}
    </div>
  );
}

function GpsSpeedHistoryChart({ history, nowMs }) {
  const width = 720;
  const height = 210;
  const padding = { left: 46, right: 18, top: 20, bottom: 32 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const latestTimestamp = history[history.length - 1]?.timestamp ?? null;
  const windowEnd = latestTimestamp == null ? nowMs : Math.max(Number(nowMs) || 0, latestTimestamp);
  const windowStart = windowEnd - 60_000;
  const visibleHistory = history.filter((point) => point.timestamp >= windowStart && point.timestamp <= windowEnd);

  if (!visibleHistory.length) {
    return (
      <div className="grid min-h-[210px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center">
        <div>
          <div className="text-sm font-extrabold text-slate-700">No speed samples in the last 60 seconds</div>
          <div className="mt-1 text-xs font-medium text-slate-500">Keep the Raspberry Pi sender running to build the rolling live graph.</div>
        </div>
      </div>
    );
  }

  const maxObserved = Math.max(0, ...visibleHistory.map((point) => point.rawSpeed ?? 0));
  const yMax = Math.max(10, Math.ceil(maxObserved / 5) * 5);
  const xFor = (timestamp) => padding.left + (Math.max(0, Math.min(60_000, timestamp - windowStart)) / 60_000) * plotWidth;
  const yFor = (speed) => padding.top + plotHeight - (Math.max(0, Math.min(yMax, speed ?? 0)) / yMax) * plotHeight;
  const rawPoints = visibleHistory.filter((point) => point.rawSpeed != null).map((point) => `${xFor(point.timestamp)},${yFor(point.rawSpeed)}`).join(' ');
  const yTicks = [0, yMax / 2, yMax];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label="Rolling 60-second raw GPS speed chart">
        <rect x="0" y="0" width={width} height={height} fill="white" />
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11" fontWeight="700">{tick.toFixed(0)}</text>
            </g>
          );
        })}
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="#cbd5e1" strokeWidth="1" />
        {rawPoints && <polyline points={rawPoints} fill="none" stroke="#d97706" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {visibleHistory.length === 1 && visibleHistory[0].rawSpeed != null && <circle cx={xFor(visibleHistory[0].timestamp)} cy={yFor(visibleHistory[0].rawSpeed)} r="4" fill="#d97706" />}
        <text x={padding.left} y={height - 9} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="700">-60s</text>
        <text x={padding.left + (plotWidth / 2)} y={height - 9} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="700">-30s</text>
        <text x={width - padding.right} y={height - 9} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="700">Now</text>
        <text x="14" y="14" fill="#64748b" fontSize="11" fontWeight="700">km/h</text>
      </svg>
    </div>
  );
}

function GpsDiagnosticsPanel({ bus, nowMs }) {
  const [history, setHistory] = useState([]);
  const gps = bus?.gps;
  const gpsTimestamp = getGpsSampleTimestamp(gps);
  const rawSpeed = toFiniteGpsNumber(gps?.rawSpeedKmh);
  const freshness = getGpsFreshness(bus, nowMs);

  useEffect(() => {
    setHistory([]);
  }, [bus?.id]);

  useEffect(() => {
    if (!bus?.id || gpsTimestamp == null || rawSpeed == null) return;
    setHistory((current) => appendGpsSpeedSample(current, {
      gpsUpdatedAt: gpsTimestamp,
      rawSpeedKmh: rawSpeed,
    }));
  }, [bus?.id, gpsTimestamp, rawSpeed]);

  if (!bus) {
    return (
      <section className="rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm">
        <div className="mb-3"><h2 className="text-[16px] font-extrabold text-slate-900">GPS Diagnostics</h2></div>
        <EmptyState compact icon={Navigation} title="No bus selected" message="Select a bus marker to view raw GPS speed and GPS movement diagnostics." />
      </section>
    );
  }

  return (
    <section className="rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm" aria-label="GPS Diagnostics">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-extrabold text-slate-900">GPS Diagnostics</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">{bus.plateNumber || 'No plate assigned'} · Bus ID: {bus.id}</p>
        </div>
        <div className="text-right" title={formatGpsLastUpdate(freshness)}>
          <div className="text-xs font-extrabold text-slate-700">{freshness.status}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{formatCompactGpsAge(freshness.ageMs)}</div>
        </div>
      </div>

      {!gps ? (
        <div className="mt-4"><EmptyState compact icon={Navigation} title="No GPS diagnostics available" message="Diagnostics will appear after this bus sends a live GPS packet." /></div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <GpsMetricCard label="Raw GPS Speed" value={rawSpeed == null ? 'Unavailable' : `${rawSpeed.toFixed(2)} km/h`} helper="Unfiltered GNSS Doppler speed" />
            <GpsMetricCard label="Motion Status" value={<GpsDiagnosticPill kind="motion" value={rawGpsMotion(gps)} />} helper="Raw speed + GPS displacement" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <GpsMetricCard label="GPS Quality" value={<GpsDiagnosticPill kind="quality" value={gps.gpsQuality} />} />
            <GpsMetricCard label="Consistency" value={<GpsDiagnosticPill kind="consistency" value={gps.consistency} />} />
            <GpsMetricCard label="H-Accuracy" value={formatGpsDiagnosticValue(gps.horizontalAccuracyM, 2, ' m')} />
            <GpsMetricCard label="GPS Drift" value={formatGpsDiagnosticValue(gps.gpsDriftM, 2, ' m')} />
            <GpsMetricCard label="Window Movement" value={formatGpsDiagnosticValue(gps.windowMovementM, 2, ' m')} />
            <GpsMetricCard label="Satellites Used" value={formatGpsDiagnosticValue(gps.satellitesUsed, 0)} helper="Display only" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <GpsMetricCard label="Movement 2s" value={formatGpsDiagnosticValue(gps.movement2sM, 2, ' m')} />
            <GpsMetricCard label="Movement 4s" value={formatGpsDiagnosticValue(gps.movement4sM, 2, ' m')} />
            <GpsMetricCard label="Movement 6s" value={formatGpsDiagnosticValue(gps.movement6sM, 2, ' m')} />
            <GpsMetricCard label="Movement Checks" value={formatGpsDiagnosticValue(gps.movementChecks, 0)} />
            <GpsMetricCard label="Start Checks" value={formatGpsDiagnosticValue(gps.startChecks, 0)} />
            <GpsMetricCard label="Recovery Checks" value={formatGpsDiagnosticValue(gps.recoveryChecks, 0)} />
          </div>

          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Raw GPS Speed · Rolling 60 seconds</h3>
                <p className="mt-0.5 text-xs font-medium text-slate-500">History is held in dashboard memory and resets when the page reloads or another bus is selected.</p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-600">
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-amber-600" /> Raw GPS</span>
              </div>
            </div>
            <GpsSpeedHistoryChart history={history} nowMs={nowMs} />
          </div>
        </>
      )}
    </section>
  );
}

/* ─── Gauge & Vehicle Condition Components ───────────────── */

function SemiCircularGauge({ needlePosition, status, scaleMarks = [], endpointLabels = [] }) {
  const isUnavailable = needlePosition == null;
  const statusColor = isUnavailable ? '#cbd5e1' : getGaugeStatusColor(status);
  const cx = 100, cy = 95, r = 72;
  const startAngle = Math.PI;
  const endAngle = 0;

  const describeArc = (startPct, endPct) => {
    const sAngle = startAngle - (startAngle - endAngle) * (startPct / 100);
    const eAngle = startAngle - (startAngle - endAngle) * (endPct / 100);
    const x1 = cx + r * Math.cos(sAngle);
    const y1 = cy - r * Math.sin(sAngle);
    const x2 = cx + r * Math.cos(eAngle);
    const y2 = cy - r * Math.sin(eAngle);
    const largeArc = Math.abs(eAngle - sAngle) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  const needleAngle = isUnavailable ? Math.PI : startAngle - (startAngle - endAngle) * (needlePosition / 100);
  const needleLength = r - 10;
  const needleTipX = cx + needleLength * Math.cos(needleAngle);
  const needleTipY = cy - needleLength * Math.sin(needleAngle);

  return (
    <svg viewBox="0 0 200 115" className="w-full max-w-[160px] mx-auto" role="img" aria-hidden="true">
      {/* Background track */}
      <path d={describeArc(0, 100)} fill="none" stroke="#e2e8f0" strokeWidth="14" strokeLinecap="round" />
      {/* Active arc */}
      {!isUnavailable && needlePosition > 0 && (
        <path d={describeArc(0, needlePosition)} fill="none" stroke={statusColor} strokeWidth="14" strokeLinecap="round" opacity="0.35" />
      )}
      {/* Tick marks */}
      {scaleMarks.map((mark, i) => {
        const pct = ((mark.value - (scaleMarks[0]?.value ?? 0)) / ((scaleMarks[scaleMarks.length - 1]?.value ?? 100) - (scaleMarks[0]?.value ?? 0))) * 100;
        const angle = startAngle - (startAngle - endAngle) * (pct / 100);
        const innerR = r - 7;
        const outerR = r + 7;
        const ix = cx + innerR * Math.cos(angle);
        const iy = cy - innerR * Math.sin(angle);
        const ox = cx + outerR * Math.cos(angle);
        const oy = cy - outerR * Math.sin(angle);
        const labelR = r + 18;
        const lx = cx + labelR * Math.cos(angle);
        const ly = cy - labelR * Math.sin(angle);
        return (
          <g key={i}>
            <line x1={ix} y1={iy} x2={ox} y2={oy} stroke="#94a3b8" strokeWidth="1.5" />
            {mark.label && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="fill-slate-400" style={{ fontSize: '9px', fontWeight: 700 }}>
                {mark.label}
              </text>
            )}
          </g>
        );
      })}
      {/* Needle */}
      <line x1={cx} y1={cy} x2={needleTipX} y2={needleTipY} stroke={isUnavailable ? '#cbd5e1' : '#1e293b'} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill={isUnavailable ? '#cbd5e1' : '#1e293b'} />
      <circle cx={cx} cy={cy} r="2.5" fill="white" />
    </svg>
  );
}

function GaugeCard({ gauge }) {
  const param = GAUGE_PARAMETERS.find(p => p.key === gauge.gaugeKey);
  if (!param) return null;
  const IconComponent = param.icon;
  const needlePosition = getGaugeNeedlePosition(gauge);
  const displayReading = getGaugeDisplayReading(gauge);
  const statusColor = getGaugeStatusColor(gauge.status);
  const isUnavailable = gauge.source === 'camera' ? !Number.isFinite(gauge.numericValue) : needlePosition == null;

  const borderClass = gauge.status === 'Normal' || gauge.status === 'Full' ? 'border-slate-200'
    : gauge.status?.includes('Critical') ? 'border-red-200'
    : gauge.status === 'Low' || gauge.status === 'Warning' || gauge.status === 'Low Pressure' || gauge.status === 'High' || gauge.status === 'High Pressure' || gauge.status === 'Cold' ? 'border-amber-200'
    : 'border-slate-200';

  return (
    <div
      className={`flex h-full min-h-[260px] flex-col items-center justify-between rounded-2xl border bg-white p-3 shadow-sm ${borderClass}`}
      role="group"
      aria-label={`${gauge.label}, ${displayReading}, status ${gauge.status}`}
    >
      {/* Header */}
      <div className="w-full flex flex-col items-center justify-center gap-1.5 mb-2">
        <div className="flex flex-col items-center gap-1">
          <div className="text-slate-400">
            <IconComponent size={18} strokeWidth={2.5} />
          </div>
          <span className="text-[12px] font-extrabold text-slate-700 text-center leading-tight">{gauge.label}</span>
        </div>
        <StatusBadge value={gauge.status} />
      </div>
      {/* Gauge Dial */}
      {gauge.source === 'camera' ? <div className="py-5 text-center text-xs font-semibold text-slate-500">Numerical reading · no alert limits applied</div> : <SemiCircularGauge
        needlePosition={needlePosition}
        status={gauge.status}
        scaleMarks={param.scaleMarks}
        endpointLabels={param.endpointLabels}
      />}
      {/* Primary Reading */}
      <div className={`text-center -mt-2 mb-1`}>
        <div className={`text-[17px] font-extrabold leading-tight ${isUnavailable ? 'text-slate-400' : 'text-slate-900'}`}>
          {displayReading}
        </div>
      </div>
      {/* Footer Metadata */}
      <div className="w-full flex flex-col items-center justify-center text-[10px] text-slate-400 font-medium mt-1 pt-2 border-t border-slate-100 gap-0.5 text-center">
        <span style={{ color: statusColor }} className="font-bold uppercase tracking-wide">{gauge.status}</span>
        <span className="leading-tight">{gauge.source === 'camera'
          ? gauge.capturedAt ? `Captured ${gauge.capturedAt} · ${Math.floor(gauge.ageMs / 1000)}s ago` : 'No capture'
          : gauge.analyzedAt ? getRelativeTime(gauge.analyzedAt) : 'No data'}</span>
        {gauge.source === 'camera' && Number.isFinite(gauge.confidence) && <span>Confidence {Math.round(gauge.confidence * 100)}%</span>}
      </div>
    </div>
  );
}

export function VehicleConditionOverview({ bus, onNavigate }) {
  const displayBus = withoutSampleConditionTelemetry(bus);
  const hasConditionData = hasValidatedConditionData(displayBus);
  const gauges = (displayBus?.gaugeReadings || []).slice(0, 6);
  const normalGauges = gauges.filter((gauge) => gauge.status === 'Normal' || gauge.status === 'Full');
  const affectedGauges = gauges.filter((gauge) => getConditionSeverity(gauge.status));
  const allNormal = gauges.length > 0 && normalGauges.length === gauges.length && getOverallVehicleCondition(displayBus) === 'Normal';
  return (
    <section className="min-w-0 rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-[16px] font-extrabold text-slate-900">Vehicle Condition</h2>
        {displayBus && <StatusBadge value={hasConditionData ? getOverallVehicleCondition(displayBus) : 'Awaiting Data'} />}
      </div>
      {!displayBus ? (
        <EmptyState compact icon={Activity} title="No bus selected" message="Register or select a bus to view its condition." />
      ) : (
        <>
          <p className="mb-3 text-sm font-medium text-slate-500">{displayBus.id || displayBus.number} · {displayBus.plateNumber || displayBus.plate || 'No plate assigned'}</p>
          {allNormal ? (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800">
              <ShieldCheck size={20} className="shrink-0" />
              <div><div className="font-extrabold">All systems normal</div><div className="text-xs font-semibold text-emerald-700">{normalGauges.length} of {gauges.length} gauges within normal range</div></div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <p className="bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">{affectedGauges.length > 0 ? `${affectedGauges.length} ${affectedGauges.length === 1 ? 'gauge requires' : 'gauges require'} attention` : hasConditionData ? `Condition summary: ${getOverallVehicleCondition(displayBus)}` : 'Awaiting validated condition data'}</p>
              <div className="divide-y divide-slate-100">
                {affectedGauges.map((gauge) => {
                  const parameter = GAUGE_PARAMETERS.find((item) => item.key === gauge.gaugeKey);
                  const GaugeIcon = parameter?.icon || Activity;
                  return (
                    <div key={gauge.id || gauge.gaugeKey} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><GaugeIcon size={16} /></span>
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-800">{gauge.label || parameter?.label}</div><div className="truncate text-xs font-medium text-slate-500">{getGaugeDisplayReading(gauge)}</div></div>
                      <StatusBadge value={gauge.status} />
                    </div>
                  );
                })}
              </div>
              {normalGauges.length > 0 && <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">{normalGauges.length} other gauge{normalGauges.length === 1 ? '' : 's'} normal</div>}
            </div>
          )}
          <button onClick={() => onNavigate('vehicle-condition')} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-slate-500 transition hover:text-[#8E1F2F]">View condition <ArrowRight size={15} /></button>
        </>
      )}
    </section>
  );
}

function OverlappingBusPicker({ buses, onSelect }) {
  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm" role="region" aria-label="Overlapping buses">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FBEDEE] text-[#8E1F2F]"><BusFront size={19} /></span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold text-slate-900">Multiple buses at this location</h2>
          <p className="mt-1 text-sm font-medium leading-5 text-slate-500">Select a bus below to lock its live details.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {buses.map((bus) => (
          <button
            type="button"
            key={bus.id}
            onClick={() => onSelect(bus)}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-[#E9C3C8] hover:bg-[#FFF8F8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"
          >
            <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: getBusMarkerIdentityColor(bus) }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold text-slate-900">{bus.plateNumber || 'No plate assigned'}</span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">Bus ID: {bus.id}</span>
            </span>
            <BusStatusBadge status={bus.status} />
            <ArrowRight size={15} className="shrink-0 text-slate-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function MonitoringOverviewFleet({
  buses,
  trips,
  selectedBusId,
  onSelectBusId,
  onNavigate,
  nowMs,
  systemHealth = deriveSystemHealth({ nowMs }),
  includeGpsDiagnosticsForTest = true,
}) {
  // Resolve against the live fleet on every render; never substitute another bus.
  const bus = buses.find((item) => item.id === selectedBusId) || null;
  const mapRegionRef = useRef(null);
  const [closingBus, setClosingBus] = useState(null);
  const [overlapBusIds, setOverlapBusIds] = useState([]);
  const overlapBuses = overlapBusIds
    .map((busId) => buses.find((item) => item.id === busId))
    .filter(Boolean);
  // Retain a non-interactive snapshot only for the brief exit transition.
  // Live selection always takes priority, including during rapid reselection.
  useEffect(() => {
    if (!closingBus) return undefined;
    if (bus) {
      setClosingBus(null);
      return undefined;
    }
    const timer = setTimeout(() => setClosingBus(null), 240);
    return () => clearTimeout(timer);
  }, [bus, closingBus]);
  const displayBus = bus || closingBus;
  const closeDetails = () => {
    setClosingBus(bus);
    setOverlapBusIds([]);
    onSelectBusId(null);
    mapRegionRef.current?.focus({ preventScroll: true });
  };
  const toggleMapSelection = (item, overlappingBuses = [], interaction = {}) => {
    if (!item?.id) return;
    if (interaction.source === 'fleet-selector') {
      setOverlapBusIds([]);
      setClosingBus(null);
      onSelectBusId(item.id);
      return;
    }
    if (overlappingBuses.length > 1) {
      setClosingBus(null);
      setOverlapBusIds(overlappingBuses.map((candidate) => candidate.id));
      onSelectBusId(null);
      return;
    }
    setOverlapBusIds([]);
    if (item.id === selectedBusId) {
      setClosingBus(bus);
      onSelectBusId(null);
      mapRegionRef.current?.focus({ preventScroll: true });
      return;
    }
    setClosingBus(null);
    onSelectBusId(item.id);
  };
  const selectOverlappingBus = (item) => {
    setOverlapBusIds([]);
    setClosingBus(null);
    onSelectBusId(item.id);
  };

  return (
    <>
      <div className="dashboard-main overview-map-details-layout grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2.4fr)_minmax(300px,0.95fr)] lg:items-stretch" data-testid="overview-map-details-layout">
      <div ref={mapRegionRef} role="region" aria-label="Fleet map" tabIndex={-1} className="map-section min-w-0 rounded-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A1262F] lg:h-full">
        <LeafletMapPanel
          selectedBus={bus}
          selectedTrip={bus ? trips.find((trip) => trip.busId === bus.id) : null}
          onSelect={toggleMapSelection}
          monitoredBuses={buses}
          routeSafeRadiusM={ROUTE_DEVIATION_DEFAULT_M}
          onCenterBus={() => {}}
          resizeSignal="overview"
          compact
          nowMs={nowMs}
          showFullMapAction
          onNavigate={onNavigate}
        />
      </div>
      <aside aria-label="Selected vehicle details" className="overview-details-column grid min-w-0 content-start gap-4">
        <SystemHealthCard health={systemHealth} nowMs={nowMs} />
        <div className="overview-details-scroll min-h-0 lg:overflow-y-auto lg:overscroll-contain" data-testid="overview-details-scroll">
        {!bus && overlapBuses.length > 1 && (
          <OverlappingBusPicker buses={overlapBuses} onSelect={selectOverlappingBus} />
        )}
        {!bus && overlapBuses.length <= 1 && (
          <div className="overview-empty-state overview-empty-state-card rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm">
            <EmptyState compact icon={BusFront} title="Select a bus on the map to view details" message="Click a vehicle marker on the map to view live information." />
          </div>
        )}
        <div className={`overview-details-transition ${bus ? 'is-open' : ''}`} aria-hidden={!bus} inert={!bus}>
          <div className="min-h-0 overflow-hidden">
            {displayBus && (
              <div className="overview-details-reveal grid min-w-0 gap-4" key={displayBus.id}>
                <ActiveBusSummary bus={displayBus} onClose={closeDetails} onNavigate={onNavigate} nowMs={nowMs} />
                <VehicleConditionOverview bus={displayBus} onNavigate={onNavigate} />
              </div>
            )}
          </div>
        </div>
        </div>
      </aside>
      </div>
      {/* TESTING/VALIDATION UI — REMOVE AFTER DUAL-DEVICE/DRIVE ACCEPTANCE */}
      {includeGpsDiagnosticsForTest && <GpsDiagnosticsPanel bus={bus} nowMs={nowMs} />}
    </>
  );
}

function getVehicleConditionDisplayBus(bus) {
  return withoutSampleConditionTelemetry(bus);
}

export function VehicleConditionSummary({ bus: suppliedBus, pageContext = 'dashboard', onNavigate,
  cameraEnabled = cameraReadingsFeatureEnabled(), cameraService, cameraCalibration, frameService = CAMERA_FRAME_SERVICE, historyService = CONDITION_HISTORY_SERVICE }) {
  const bus = getVehicleConditionDisplayBus(suppliedBus);
  const [refreshState, setRefreshState] = useState({ status: 'idle', message: '' });

  useEffect(() => setRefreshState({ status: 'idle', message: '' }), [bus?.id]);

  if (!bus) {
    return (
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm">
        <h2 className="text-[15px] font-extrabold text-slate-900 mb-4">Vehicle Condition</h2>
        <EmptyState compact icon={Activity} title="No bus selected" message="Select a bus from the fleet or map to view condition." />
      </section>
    );
  }

  const hasConditionData = hasValidatedConditionData(bus);
  const overallCondition = getOverallVehicleCondition(bus);
  const borderTone = overallCondition === 'Critical' ? 'border-red-200' : overallCondition === 'Warning' ? 'border-amber-200' : 'border-slate-200/80';
  const displayBusId = bus.number || bus.id || 'No bus selected';
  const displayPlate = bus.plate || bus.plateNumber || 'No plate assigned';
  const refreshBusData = async () => {
    if (!bus.id || refreshState.status === 'loading') return;
    setRefreshState({ status: 'loading', message: '' });
    try {
      const { data, error } = await supabase
        .from('buses')
        .select('bus_id')
        .eq('bus_id', bus.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('missing-bus');

      setRefreshState({ status: 'success', message: 'Bus record verified in Supabase. Live sensor listeners remain active.' });
    } catch (refreshError) {
      console.error('Unable to refresh bus data:', refreshError.code || 'refresh-failed', refreshError.message);
      setRefreshState({ status: 'error', message: 'Unable to refresh this bus record.' });
    }
  };

  if (pageContext === 'vehicle-condition') {
    return <section className={`condition-summary-compact ${borderTone}`} aria-label="Vehicle condition readings">
      <header className="condition-summary-toolbar">
        <div><h2>Gauge readings</h2><p title="Needle positions from the camera. Physical accuracy has not been independently verified.">Camera estimates</p></div>
        <div className="condition-page-actions">
          {hasConditionData && <StatusBadge value={overallCondition} />}
          <button type="button" onClick={() => onNavigate('live-camera')}><Camera size={14} />Live camera</button>
          <button type="button" onClick={() => onNavigate({ page: 'records', bus: bus.id, tab: 'condition-history' })}><FileClock size={14} />History</button>
          <ConditionHistoryExport key={bus.id} bus={bus} service={historyService} />
        </div>
      </header>
      {frameService?.enabled ? <CameraFrameGaugePanel compact key={bus.id} busId={bus.id} service={frameService} />
        : cameraEnabled ? <CameraGaugePanel enabled busId={bus.id} service={cameraService} calibration={cameraCalibration}
          renderGauge={(gauge) => <GaugeCard gauge={gauge} />} />
        : (bus.gaugeReadings || []).length ? <div className="condition-legacy-grid">{[...bus.gaugeReadings]
          .sort((a, b) => a.displayOrder - b.displayOrder).map(gauge => <GaugeCard key={gauge.id} gauge={gauge} />)}</div>
        : <div className="condition-camera-snapshot">
          <p role="status" className="condition-camera-status"><strong>Waiting for readings</strong><span>No camera data</span></p>
          <div className="camera-condition-grid">{LIVE_GAUGE_PLACEHOLDERS.map(gauge => <AnimatedCameraGauge compact key={gauge.gaugeKey} gauge={gauge} />)}</div>
        </div>}
    </section>;
  }

  return (
    <section className={`min-w-0 overflow-hidden rounded-[18px] border bg-white p-[18px] shadow-sm ${borderTone}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-extrabold text-slate-900">Vehicle Condition</h2>
          <p className="mt-1 text-sm font-extrabold text-slate-800">{displayPlate}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">Bus ID: {displayBusId}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <StatusBadge value={hasConditionData ? overallCondition : 'Awaiting Data'} />
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {(() => {
          const gauges = bus.gaugeReadings || [];
          const gaugeOk = gauges.filter(g => g.status === 'Normal' || g.status === 'Full').length;
          const gaugeAbnormal = gauges.length - gaugeOk;
          const metricTotal = gauges.length;
          const metricNormal = gaugeOk;
          const metricAbnormal = gaugeAbnormal;
          const metricLabel = 'Gauges';
          const latestConditionUpdateMs = getTimestampMs(bus.lastGaugeAnalysisMs);
          
          let mostImportantIssue = hasConditionData ? 'No active issues in available readings' : 'Awaiting validated condition data';
          let mostImportantTone = hasConditionData && overallCondition === 'Normal' ? 'emerald' : 'gray';
          if (hasConditionData && overallCondition !== 'Normal') {
            const criticalGauge = gauges.find(g => g.status?.includes('Critical'));
            const warningGauge = gauges.find(g => g.status === 'Low' || g.status === 'Warning' || g.status === 'High' || g.status === 'High Pressure' || g.status === 'Low Pressure');
            
            if (criticalGauge) { mostImportantIssue = `${criticalGauge.label} · ${getGaugeDisplayReading(criticalGauge)}`; mostImportantTone = 'red'; }
            else if (warningGauge) { mostImportantIssue = `${warningGauge.label} · ${getGaugeDisplayReading(warningGauge)}`; mostImportantTone = 'amber'; }
            else mostImportantIssue = `Condition summary: ${overallCondition}`;
          }

          return (
            <div className={`grid gap-4 ${pageContext === 'vehicle-condition' ? 'md:grid-cols-[2fr_1fr]' : 'grid-cols-1'}`}>
              <div className="flex flex-col gap-4">
                <div className={`rounded-xl border p-4 ${mostImportantTone === 'red' ? 'border-red-200 bg-red-50 text-red-900' : mostImportantTone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : mostImportantTone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  <div className="text-[11px] font-extrabold uppercase tracking-wide opacity-80 mb-1">{hasConditionData ? 'Highest-Priority Issue' : 'Vehicle Condition'}</div>
                  <div className="text-base font-bold leading-tight">{mostImportantIssue}</div>
                </div>
                {hasConditionData ? <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="text-2xl font-black text-slate-800">{metricTotal > 0 ? (metricAbnormal > 0 ? metricAbnormal : `${metricNormal} of ${metricTotal}`) : overallCondition}</div>
                    <div className="text-[11px] font-bold uppercase text-slate-500">{metricTotal > 0 ? (metricAbnormal > 0 ? `${metricLabel} Require Attention` : `${metricLabel} Within Normal Range`) : 'Condition Summary'}</div>
                  </div>
                  <div className="rounded-xl border border-slate-100 p-2 flex flex-col justify-center">
                    <div className="font-bold text-slate-500 text-[11px] uppercase">Latest Sensor Update</div>
                    <div title={formatTimestamp(latestConditionUpdateMs)} className="mt-1 font-extrabold text-slate-900 text-[13px]">{latestConditionUpdateMs ? getRelativeTime(latestConditionUpdateMs) : 'Unknown'}</div>
                  </div>
                </div> : <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">Gauge details will appear after the first validated sensor reading.</p>}
              </div>
              {pageContext === 'vehicle-condition' && (
                <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500 mb-1">Quick Actions</div>
                  <button type="button" disabled title="No image capture is available for this bus" className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-bold text-slate-400 opacity-70">
                    <Camera size={16} /> View Latest Capture
                  </button>
                  <button type="button" onClick={refreshBusData} disabled={refreshState.status === 'loading'} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
                    <RefreshCcw size={16} className={refreshState.status === 'loading' ? 'animate-spin' : ''} /> {refreshState.status === 'loading' ? 'Refreshing…' : 'Force Refresh Data'}
                  </button>
                  {refreshState.message && <p role={refreshState.status === 'error' ? 'alert' : 'status'} className={`text-xs font-semibold ${refreshState.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{refreshState.message}</p>}
                </div>
              )}
            </div>
          );
        })()}

        <div className="pt-3 border-t border-slate-100">
           <div className="flex items-center justify-between mb-3">
             <h3 className="text-[13px] font-extrabold text-slate-900 uppercase tracking-wide">Gauge Panel Readings</h3>
           </div>
           <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
              {frameService?.enabled ? <CameraFrameGaugePanel key={bus.id} busId={bus.id} service={frameService} />
              : cameraEnabled ? <CameraGaugePanel enabled busId={bus.id} service={cameraService} calibration={cameraCalibration} renderGauge={(gauge) => <GaugeCard gauge={gauge} />} />
              : (bus.gaugeReadings || []).length > 0 ? [...bus.gaugeReadings].sort((a,b) => a.displayOrder - b.displayOrder).map(gauge => (
                <GaugeCard key={gauge.id} gauge={gauge} />
              )) : (
                <div className="col-span-full">
                  <EmptyState compact icon={Activity} title={hasConditionData ? 'No gauge-panel data' : 'Awaiting validated condition data'} message="No validated gauge-panel readings are available for this bus." />
                </div>
              )}
           </div>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        {pageContext === 'dashboard' ? (
          <button onClick={() => onNavigate('vehicle-condition')} className="w-full rounded-xl border border-[#E9C3C8] bg-[#FBEDEE]/70 px-4 py-3 text-[13px] font-extrabold text-[#8E1F2F] transition hover:bg-[#FBEDEE] active:scale-[0.98]">
            View Vehicle Condition
          </button>
        ) : (
          <>
            <button onClick={() => onNavigate('map')} className="flex-1 rounded-xl border border-[#E9C3C8] bg-[#FBEDEE]/70 px-4 py-3 text-[13px] font-extrabold text-[#8E1F2F] transition hover:bg-[#FBEDEE] active:scale-[0.98]">
              View Bus on Map
            </button>
            <button onClick={() => onNavigate({ page: 'records', bus: bus.id, tab: 'condition-history' })} className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] font-extrabold text-slate-700 transition hover:bg-slate-100 active:scale-[0.98]">
              View Condition History
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/* ─── Map Components ────────────────────────────── */

export function BusDetailsPanel({ bus, onNavigate, nowMs, compact = false }) {
  if (!bus) return <section className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm"><h2 className="text-[15px] font-extrabold text-slate-900">Bus Details</h2><div className="mt-4"><EmptyState compact icon={BusFront} title="No bus selected" message="Select an available bus to view its details." /></div></section>;
  const coordinates = getBusCoordinates(bus);
  const liveSpeed = rawGpsSpeed(bus.gps);
  const gpsFreshness = getGpsFreshness(bus, nowMs);
  if (compact) {
    const routeStatus = getRouteAssessmentPresentation(bus.gps, nowMs);
    return <section className="condition-bus-summary" aria-label="Selected bus details">
      <header>
        <div className="condition-bus-identity"><h2 title={`Bus ID: ${bus.id}`}>{bus.plateNumber || 'No plate assigned'}</h2>{visibleRouteName(bus.routeName) && <span>{visibleRouteName(bus.routeName)}</span>}</div>
        <div className="condition-bus-status"><BusStatusBadge status={bus.status} />
          <span className="condition-gps-status" title={formatGpsLastUpdate(gpsFreshness)}>GPS {gpsFreshness.status} · {formatCompactGpsAge(gpsFreshness.ageMs)}</span>
          <button type="button" onClick={() => onNavigate('map')} aria-label="View selected bus on map"><Map size={14} />Map</button>
        </div>
      </header>
      <div className="condition-bus-facts">
        <span>{gpsFreshness.status === 'Online' ? 'Speed' : 'Last speed'} <strong>{Number.isFinite(liveSpeed) ? `${liveSpeed} km/h` : '—'}</strong></span>
        <div aria-label="Route Monitoring"><span data-route-tone={routeStatus.tone} className={routeStatus.className}>{routeStatus.label}</span>
          <span title={routeStatus.lastKnown ? 'Last-known distance from assigned route' : 'Distance from assigned route'}>{formatDistanceFromRoute(bus.gps?.distanceFromRouteM)} from route</span>
        </div>
      </div>
    </section>;
  }
  return (
    <section className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200/80 bg-white p-[18px] shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-[15px] font-extrabold text-slate-900">Bus Details</h2><p className="mt-1 truncate text-lg font-extrabold text-slate-900">{bus.plateNumber || 'No plate assigned'}</p><p className="mt-0.5 truncate text-xs font-medium text-slate-500">Bus ID: {bus.id}</p></div>
        <div title="Operational bus status is independent of GPS freshness"><div className="mb-1 text-[10px] text-slate-500">Bus record</div><BusStatusBadge status={bus.status} /></div>
      </div>
      <div className="grid gap-4 border-y border-slate-100 py-4 sm:grid-cols-3">
        <div><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Vehicle</div>{visibleRouteName(bus.routeName) && <div className="mt-1 text-sm font-bold text-slate-700">{visibleRouteName(bus.routeName)}</div>}<div className="mt-1 text-xs font-medium text-slate-500">Bus Record Updated: {formatRecordTimestamp(bus.updatedAt)}</div></div>
        <div><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Tracking</div><div className="mt-1 text-sm font-bold text-slate-700">{Number.isFinite(liveSpeed) ? `${liveSpeed} km/h` : 'Speed unavailable'}</div><div className="mt-1 text-xs font-medium text-slate-500">{coordinates ? `${coordinates.lat}, ${coordinates.lng}` : 'Location not available'}</div></div>
        <div title={formatGpsLastUpdate(gpsFreshness)}><div className="text-xs font-bold uppercase tracking-wide text-slate-400">GPS</div><div className="mt-1 text-sm font-bold text-slate-700">{gpsFreshness.status}</div><div className="mt-1 text-xs font-medium text-slate-500">{formatCompactGpsAge(gpsFreshness.ageMs)}</div></div>
      </div>
      <RouteMonitoringSection gps={bus.gps} nowMs={nowMs} />
      <button onClick={() => onNavigate('map')} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-slate-500 transition hover:text-[#8E1F2F]">View bus on map <ArrowRight size={15} /></button>
    </section>
  );
}

function AnimatedRadiusCircle({ center, radius }) {
  return (
    <Circle
      center={center}
      radius={radius}
      pathOptions={{ color: '#0ea5e9', fillColor: '#38bdf8', fillOpacity: 0.1, weight: 1, dashArray: '4,4' }}
    />
  );
}

export function AssignedRouteLine({ routePoints }) {
  if (!routePoints || routePoints.length < 2) return null;
  return (
    <Polyline
      positions={routePoints.map((p) => [p.lat, p.lng])}
      pathOptions={{ color: '#0ea5e9', weight: 4, opacity: 0.6 }}
    />
  );
}

export function getFleetResetTarget(selectedBus, visiblePoints = [], routePoints = []) {
  const selected = isMarkerEligible(selectedBus) ? getBusCoordinates(selectedBus) : null;
  if (selected) return { center: [selected.lat, selected.lng], zoom: 14 };
  const points = visiblePoints.filter((point) => validGpsPair(point?.lat, point?.lng));
  if (points.length === 1) return { center: [Number(points[0].lat), Number(points[0].lng)], zoom: 14 };
  if (points.length > 1) return { points, padding: [60, 60], maxZoom: 14 };
  const route = routePoints.filter((point) => validGpsPair(point?.lat, point?.lng));
  return { points: route.length > 1 ? route : fpipToLimaWaypoints, padding: [50, 50], maxZoom: 14 };
}

function focusFleetMap(map, target) {
  if (map._loaded === false) return;
  map.stop?.();
  map.invalidateSize();
  if (target.center) map.flyTo(target.center, target.zoom, { animate: true, duration: 0.6 });
  else map.flyToBounds(L.latLngBounds(target.points.map((point) => [point.lat, point.lng])), {
    padding: target.padding, maxZoom: target.maxZoom, animate: true, duration: 0.6,
  });
}

export function MapViewportController({ selectedBus, visiblePoints, routePoints, centerBusSignal, centerAllSignal, resetViewSignal, resizeSignal }) {
  const map = useMap();
  const selectedBusRef = useRef(selectedBus);
  const visiblePointsRef = useRef(visiblePoints);
  const routePointsRef = useRef(routePoints);
  selectedBusRef.current = selectedBus;
  visiblePointsRef.current = visiblePoints;
  routePointsRef.current = routePoints;
  
  useEffect(() => {
    const selectedCoordinates = getBusCoordinates(selectedBusRef.current);
    if (centerBusSignal > 0 && selectedCoordinates) {
      map.flyTo([selectedCoordinates.lat, selectedCoordinates.lng], 14, { animate: true, duration: 1 });
    }
  }, [centerBusSignal, map]);

  useEffect(() => {
    const points = visiblePointsRef.current;
    if (centerAllSignal > 0) focusFleetMap(map, getFleetResetTarget(null, points, routePointsRef.current));
  }, [centerAllSignal, map]);

  useEffect(() => {
    if (resetViewSignal > 0) focusFleetMap(map, getFleetResetTarget(
      selectedBusRef.current, visiblePointsRef.current, routePointsRef.current,
    ));
  }, [resetViewSignal, map]);

  useEffect(() => {
    let active = true;
    let frame = null;
    let observer = null;
    const invalidateSize = () => {
      if (active) map.invalidateSize();
    };
    const scheduleResize = () => {
      if (!active || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        invalidateSize();
      });
    };
    const timer = setTimeout(scheduleResize, 100);
    const stopResize = () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
    };
    // Leaflet removes its map pane on unload, before React child cleanup may run.
    map.on('unload', stopResize);
    window.addEventListener('resize', scheduleResize);
    const container = map.getContainer();
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleResize);
      observer.observe(container);
    }
    scheduleResize();
    return () => {
      stopResize();
      map.off('unload', stopResize);
    };
  }, [resizeSignal, map]);

  return null;
}

export function FitFleetBounds({ buses }) {
  const map = useMap();
  const hasInitializedViewport = useRef(false);
  const validPositions = buses
    .map(getBusCoordinates)
    .filter(Boolean)
    .map((coordinates) => [coordinates.lat, coordinates.lng]);
  const positionedBusKey = buses
    .filter((bus) => getBusCoordinates(bus))
    .map((bus) => bus.id)
    .sort()
    .join('|');

  useEffect(() => {
    if (hasInitializedViewport.current) return undefined;
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (!active || map._loaded === false) return;
      map.invalidateSize();
      if (validPositions.length === 1) {
        map.setView(validPositions[0], 13);
        hasInitializedViewport.current = true;
      } else if (validPositions.length > 1) {
        map.fitBounds(L.latLngBounds(validPositions), { padding: [60, 60], maxZoom: 13 });
        hasInitializedViewport.current = true;
      } else {
        map.setView([14.1079, 121.1414], 11);
      }
    });
    const cancel = () => { active = false; cancelAnimationFrame(frame); };
    map.on?.('unload', cancel);
    return () => { cancel(); map.off?.('unload', cancel); };
  }, [map, positionedBusKey]);

  return null;
}

const GPS_MARKER_ANIMATION_MS = 400;
const GPS_MARKER_MAX_ANIMATION_MS = 1000;
export function getMarkerAnimationDuration(spacingMs) {
  return Number.isFinite(spacingMs) && spacingMs > 0
    ? clampNumber(spacingMs * 0.3, 150, GPS_MARKER_MAX_ANIMATION_MS)
    : GPS_MARKER_ANIMATION_MS;
}
const GPS_MARKER_JUMP_THRESHOLD_M = 2000;
export const BUS_CALLOUT_EDGE_PADDING_PX = 16;
export const BUS_CALLOUT_MAX_WIDTH_PX = 284;
const BUS_CALLOUT_FALLBACK_HEIGHT_PX = 260;

function clampNumber(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getBusCalloutPlacement(map, position, options = {}) {
  const markerOffset = Number.isFinite(Number(options.markerOffset)) ? Number(options.markerOffset) : 22;
  const edgePadding = Number.isFinite(Number(options.edgePadding)) ? Number(options.edgePadding) : BUS_CALLOUT_EDGE_PADDING_PX;
  const requestedWidth = Number.isFinite(Number(options.width)) ? Number(options.width) : BUS_CALLOUT_MAX_WIDTH_PX;
  const requestedHeight = Number.isFinite(Number(options.height)) ? Number(options.height) : BUS_CALLOUT_FALLBACK_HEIGHT_PX;
  const fallback = {
    direction: 'right',
    offset: [Math.round(markerOffset), 0],
    width: Math.round(requestedWidth),
    maxHeight: Math.round(requestedHeight),
  };

  const lat = Array.isArray(position) ? Number(position[0]) : Number(position?.lat);
  const lng = Array.isArray(position) ? Number(position[1]) : Number(position?.lng);
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lng) || typeof map.getSize !== 'function' || typeof map.latLngToContainerPoint !== 'function') {
    return fallback;
  }

  const mapSize = map.getSize();
  const mapWidth = Number(mapSize?.x);
  const mapHeight = Number(mapSize?.y);
  if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight) || mapWidth <= 0 || mapHeight <= 0) return fallback;

  const markerPoint = map.latLngToContainerPoint([lat, lng]);
  const markerX = Number(markerPoint?.x);
  const markerY = Number(markerPoint?.y);
  if (!Number.isFinite(markerX) || !Number.isFinite(markerY)) return fallback;

  const availableWidth = Math.max(1, mapWidth - (edgePadding * 2));
  const availableHeight = Math.max(1, mapHeight - (edgePadding * 2));
  const tooltipWidth = Math.min(Math.max(1, requestedWidth), availableWidth);
  const tooltipHeight = Math.min(Math.max(1, requestedHeight), availableHeight);
  const minLeft = edgePadding;
  const maxLeft = Math.max(minLeft, mapWidth - edgePadding - tooltipWidth);
  const naturalRightLeft = markerX + markerOffset;
  const naturalLeftLeft = markerX - markerOffset - tooltipWidth;
  const rightFits = naturalRightLeft >= minLeft && naturalRightLeft <= maxLeft;
  const leftFits = naturalLeftLeft >= minLeft && naturalLeftLeft <= maxLeft;
  const direction = rightFits ? 'right' : leftFits ? 'left' : (mapWidth - markerX >= markerX ? 'right' : 'left');
  const naturalLeft = direction === 'left' ? naturalLeftLeft : naturalRightLeft;
  const clampedLeft = clampNumber(naturalLeft, minLeft, maxLeft);
  const xOffset = direction === 'left'
    ? clampedLeft - (markerX - tooltipWidth)
    : clampedLeft - markerX;

  const minTop = edgePadding;
  const maxTop = Math.max(minTop, mapHeight - edgePadding - tooltipHeight);
  const naturalTop = markerY - (tooltipHeight / 2);
  const clampedTop = clampNumber(naturalTop, minTop, maxTop);
  const yOffset = clampedTop - naturalTop;

  return {
    direction,
    offset: [Math.round(xOffset), Math.round(yOffset)],
    width: Math.round(tooltipWidth),
    maxHeight: Math.round(tooltipHeight),
  };
}

export function BusMarkerCallout({ bus, nowMs }) {
  const coordinates = getBusCoordinates(bus);
  const gpsFreshness = getMarkerGpsFreshness(bus, nowMs);
  const hasCurrentCoordinates = validGpsPair(bus.gps?.liveLatitude, bus.gps?.liveLongitude)
    || validGpsPair(bus.gps?.latitude, bus.gps?.longitude);
  const distanceFromRoute = formatDistanceFromRoute(bus.gps?.distanceFromRouteM);
  return (
    <div className="centrabus-map-callout__content min-w-0 font-sans text-slate-800">
      <div className="flex items-start justify-between gap-2.5 border-b border-slate-100 pb-2">
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold text-slate-950">{bus.plateNumber || 'No plate assigned'}</div>
          <div className="mt-0.5 text-[10px] font-medium leading-4 text-slate-500">{!coordinates ? 'No GPS location' : hasCurrentCoordinates && gpsFreshness.status === 'Online' ? 'Current filtered GPS position' : 'Last-known GPS position'}</div>
        </div>
        <div title="Operational bus status is independent of GPS freshness"><div className="mb-1 text-[10px] text-slate-500">Bus record</div><BusStatusBadge status={bus.status} /></div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 py-2.5">
        {visibleRouteName(bus.routeName) && <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Route</div>
          <div className="mt-0.5 break-words text-xs font-bold leading-5 text-slate-800">{visibleRouteName(bus.routeName)}</div>
        </div>}
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">GPS Status</div>
          <div className="mt-0.5"><StatusBadge value={gpsFreshness.status} /></div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Speed</div>
          <div className="mt-0.5 text-xs font-bold leading-5 text-slate-800">{rawGpsSpeed(bus.gps) !== null ? `${rawGpsSpeed(bus.gps)} km/h` : 'Unavailable'}</div>
          <div className="text-[10px] text-slate-500">Raw GPS · Motion at fix: {rawGpsMotion(bus.gps)}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Location</div>
          <div className="mt-0.5 break-words text-[11px] font-bold leading-4 text-slate-800">{coordinates ? `${coordinates.lat}, ${coordinates.lng}` : 'Unavailable'}</div>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Route Monitoring</div>
          <RouteStatusBadge gps={bus.gps} nowMs={nowMs} />
        </div>
        <div className="mt-1.5 text-[11px] font-semibold leading-4 text-slate-600">
          {distanceFromRoute === 'Unavailable' ? 'Distance from assigned route unavailable' : `${gpsFreshness.status === 'Online' ? '' : 'Last known: '}${distanceFromRoute} from assigned route`}
        </div>
      </div>
      <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Last GPS Update</div>
          <div className="mt-0.5 break-words text-[11px] font-semibold leading-4 text-slate-600">{formatGpsLastUpdate(gpsFreshness)}</div>
        </div>
        <details className="text-[10px] text-slate-400">
          <summary className="cursor-pointer">Bus record metadata</summary>
          <div className="break-all">Bus ID: {bus.id}</div>
          <div>Bus Record Updated</div>
          <div>{formatRecordTimestamp(bus.updatedAt)}</div>
        </details>
      </div>
    </div>
  );
}

function BusMarkerTooltip({ bus, nowMs, position, calloutOffset, pinned = false, onClose, previewOpen = false }) {
  const map = useMap();
  const tooltipRef = useRef(null);
  const positionRef = useRef(position);
  const calloutOffsetRef = useRef(calloutOffset);
  const placementRef = useRef(null);
  const schedulePlacementRef = useRef(null);
  const [placement, setPlacement] = useState(() => getBusCalloutPlacement(map, position, { markerOffset: calloutOffset }));

  positionRef.current = position;
  calloutOffsetRef.current = calloutOffset;

  useEffect(() => {
    let animationFrame = null;
    let disposed = false;

    const updatePlacement = () => {
      if (disposed || map._loaded === false) return;
      const tooltip = tooltipRef.current;
      const tooltipElement = typeof tooltip?.getElement === 'function' ? tooltip.getElement() : null;
      const measuredWidth = Number(tooltipElement?.offsetWidth);
      const measuredHeight = Number(tooltipElement?.offsetHeight);
      const nextPlacement = getBusCalloutPlacement(map, positionRef.current, {
        markerOffset: calloutOffsetRef.current,
        width: measuredWidth > 0 ? measuredWidth : undefined,
        height: measuredHeight > 0 ? measuredHeight : undefined,
      });

      if (tooltip) {
        tooltip.options.direction = nextPlacement.direction;
        tooltip.options.offset = nextPlacement.offset;
        if (tooltipElement && typeof tooltip.update === 'function') tooltip.update();
      }

      const currentPlacement = placementRef.current;
      if (
        !currentPlacement
        || currentPlacement.direction !== nextPlacement.direction
        || currentPlacement.offset[0] !== nextPlacement.offset[0]
        || currentPlacement.offset[1] !== nextPlacement.offset[1]
        || currentPlacement.width !== nextPlacement.width
        || currentPlacement.maxHeight !== nextPlacement.maxHeight
      ) {
        placementRef.current = nextPlacement;
        setPlacement(nextPlacement);
      }
    };

    const schedulePlacement = () => {
      if (disposed || animationFrame !== null) return;
      const run = () => {
        animationFrame = null;
        updatePlacement();
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        animationFrame = window.requestAnimationFrame(run);
      } else {
        run();
      }
    };

    schedulePlacementRef.current = schedulePlacement;
    schedulePlacement();
    ['move', 'zoom', 'resize', 'tooltipopen'].forEach((eventName) => map.on?.(eventName, schedulePlacement));
    const cancelPlacement = () => {
      disposed = true;
      if (animationFrame !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = null;
      schedulePlacementRef.current = null;
    };
    map.on?.('unload', cancelPlacement);
    return () => {
      cancelPlacement();
      ['move', 'zoom', 'resize', 'tooltipopen'].forEach((eventName) => map.off?.(eventName, schedulePlacement));
      map.off?.('unload', cancelPlacement);
    };
  }, [map]);

  useEffect(() => {
    schedulePlacementRef.current?.();
  }, [bus.id, position?.[0], position?.[1]]);

  return (
    <Tooltip
      ref={tooltipRef}
      className={`centrabus-map-callout${pinned ? ' is-pinned' : ''}`}
      permanent={pinned || previewOpen}
      direction={placement.direction}
      offset={placement.offset}
      opacity={1}
      interactive
    >
      {pinned && <div className="mb-1 flex justify-end"><button type="button" aria-label="Close bus popup" onClick={(event) => { event.stopPropagation(); onClose(); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={16} /></button></div>}
      <BusMarkerCallout bus={bus} nowMs={nowMs} />
    </Tooltip>
  );
}

export function AnimatedBusMarker({ bus, icon, isSelected, onSelect, nowMs, isPinned = false, onClosePopup, pixelOffset = null, groupBuses = null, groupPinnedBusId = null }) {
  const map = useMap();
  const markerRef = useRef(null);
  const [hoveredGroupBusId, setHoveredGroupBusId] = useState(null);
  const focusedGroupBusId = useRef(null);
  const groupBusesRef = useRef(groupBuses);
  groupBusesRef.current = groupBuses;
  const anchorIcon = useMemo(createBusGpsAnchorIcon, []);
  const coordinates = getBusCoordinates(bus);
  const freshness = getMarkerGpsFreshness(bus, nowMs).status;
  const canAnimate = freshness === 'Online' || freshness === 'Delayed';
  const [displayedPosition, setDisplayedPosition] = useState(() => (coordinates ? [coordinates.lat, coordinates.lng] : null));
  const displayedPositionRef = useRef(displayedPosition);
  const animationFrameRef = useRef(null);
  const generationRef = useRef(0);
  const destroyedRef = useRef(false);
  const lastFixRef = useRef({ busId: bus.id, arrivedAt: null, capturedAt: getGpsSampleTimestamp(bus.gps) });

  // DOM delegation distinguishes chips within one Leaflet marker. Leaflet's
  // outer mouseover/out events alone cannot distinguish sibling chip hovers.
  useEffect(() => {
    if (!groupBuses) return undefined;
    const root = markerRef.current?.getElement?.();
    if (!root) return undefined;
    const busIdAt = (target) => {
      const chip = target?.closest?.('button[data-bus-id]');
      return chip && root.contains(chip) ? chip.dataset.busId : null;
    };
    const enter = (event) => {
      if (destroyedRef.current || map._loaded === false) return;
      setHoveredGroupBusId(busIdAt(event.target));
    };
    const leave = (event) => setHoveredGroupBusId(busIdAt(event.relatedTarget));
    const focus = (event) => { focusedGroupBusId.current = busIdAt(event.target); enter(event); };
    const blur = (event) => { focusedGroupBusId.current = busIdAt(event.relatedTarget); leave(event); };
    root.addEventListener('pointerover', enter);
    root.addEventListener('pointerout', leave);
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', blur);
    // setIcon replaces the chip DOM, but must not strand keyboard focus.
    if (focusedGroupBusId.current && document.activeElement === document.body) {
      [...root.querySelectorAll('button[data-bus-id]')]
        .find((chip) => chip.dataset.busId === focusedGroupBusId.current)?.focus({ preventScroll: true });
    }
    return () => {
      root.removeEventListener('pointerover', enter);
      root.removeEventListener('pointerout', leave);
      root.removeEventListener('focusin', focus);
      root.removeEventListener('focusout', blur);
    };
  }, [icon, Boolean(groupBuses), map]);

  useEffect(() => {
    if (coordinates && displayedPosition?.[0] === coordinates.lat && displayedPosition?.[1] === coordinates.lng) {
      recordGpsLatency('marker-target-applied', { busId: bus.id, capturedAt: getGpsSampleTimestamp(bus.gps) });
    }
  }, [bus.id, bus.gps?.gpsUpdatedAt, displayedPosition?.[0], displayedPosition?.[1], coordinates?.lat, coordinates?.lng]);

  useEffect(() => {
    destroyedRef.current = false;
    const cancel = () => {
      destroyedRef.current = true;
      generationRef.current += 1;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
    map.on?.('unload', cancel);
    return () => {
      cancel();
      map.off?.('unload', cancel);
    };
  }, [map]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const cancel = () => {
      generationRef.current += 1;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
    if (!coordinates || destroyedRef.current || map._loaded === false) return cancel;
    const nextPosition = [coordinates.lat, coordinates.lng];
    const previousPosition = displayedPositionRef.current;
    const busChanged = lastFixRef.current.busId !== bus.id;
    const arrivedAt = performance.now();
    const previousArrival = busChanged ? null : lastFixRef.current.arrivedAt;
    const capturedAt = getGpsSampleTimestamp(bus.gps);
    const longGap = capturedAt && lastFixRef.current.capturedAt && capturedAt - lastFixRef.current.capturedAt > 30_000;
    lastFixRef.current = { busId: bus.id, arrivedAt, capturedAt };
    if (!previousPosition || busChanged || !canAnimate || longGap) {
      displayedPositionRef.current = nextPosition;
      setDisplayedPosition(nextPosition);
      return cancel;
    }

    const jumpDistanceM = Math.hypot(
      projectToMeters({ lat: nextPosition[0], lng: nextPosition[1] }, { lat: previousPosition[0], lng: previousPosition[1] }).x,
      projectToMeters({ lat: nextPosition[0], lng: nextPosition[1] }, { lat: previousPosition[0], lng: previousPosition[1] }).y,
    );
    if (jumpDistanceM > GPS_MARKER_JUMP_THRESHOLD_M) {
      displayedPositionRef.current = nextPosition;
      setDisplayedPosition(nextPosition);
      return cancel;
    }

    if (previousPosition[0] === nextPosition[0] && previousPosition[1] === nextPosition[1]) return cancel;
    // No extrapolation or fixed multi-second buffer. Adapt to actual arrivals,
    // Use only 30% of observed spacing (150-1000ms), never a telemetry-length
    // buffer. Retarget immediately from the currently rendered coordinate.
    const duration = getMarkerAnimationDuration(previousArrival === null ? null : arrivedAt - previousArrival);
    const animationStart = arrivedAt;
    const animate = (timestamp) => {
      if (destroyedRef.current || map._loaded === false || generationRef.current !== generation) return;
      const progress = clampNumber((timestamp - animationStart) / duration, 0, 1);
      const easedProgress = progress * progress * (3 - (2 * progress));
      const position = progress === 1 ? nextPosition : [
        previousPosition[0] + (nextPosition[0] - previousPosition[0]) * easedProgress,
        previousPosition[1] + (nextPosition[1] - previousPosition[1]) * easedProgress,
      ];
      displayedPositionRef.current = position;
      setDisplayedPosition(position);
      if (progress < 1) animationFrameRef.current = requestAnimationFrame(animate);
      else animationFrameRef.current = null;
    };
    animationFrameRef.current = requestAnimationFrame(animate);
    return cancel;
  }, [bus.id, coordinates?.lat, coordinates?.lng, canAnimate, map]);

  if (!displayedPosition || destroyedRef.current || map._loaded === false) return null;
  const markerPosition = getOffsetBusMarkerPosition(map, displayedPosition, pixelOffset);
  const isVisuallyOffset = markerPosition !== displayedPosition
    && (markerPosition[0] !== displayedPosition[0] || markerPosition[1] !== displayedPosition[1]);
  const anchorPosition = pixelOffset?.sharedAnchorPosition || displayedPosition;
  const iconSize = Number(icon?.options?.markerVisibleSize);
  const calloutOffset = Number.isFinite(iconSize) ? Math.round((iconSize / 2) + 4) : 22;
  const tooltipBus = groupBuses
    ? groupBuses.find((member) => member.id === (isPinned ? groupPinnedBusId : hoveredGroupBusId))
    : bus;
  return (
    <>
      {isVisuallyOffset && (
        <>
          {pixelOffset.showAnchor && (
            <Marker
              key="gps-anchor"
              position={anchorPosition}
              icon={anchorIcon}
              interactive={false}
              keyboard={false}
              zIndexOffset={-1000}
              title={pixelOffset.sharedAnchorPosition ? 'Shared GPS position' : 'True GPS position'}
            />
          )}
        </>
      )}
      <Marker
        ref={markerRef}
        key="bus-icon"
        position={markerPosition}
        icon={icon}
        zIndexOffset={isSelected ? 1000 : 0}
        riseOnHover
        riseOffset={500}
        keyboard={groupBuses ? false : undefined}
        eventHandlers={{ click: (event) => {
          if (destroyedRef.current || map._loaded === false) return;
          if (!groupBusesRef.current) { onSelect(bus); return; }
          const target = (event?.originalEvent || event?.nativeEvent || event)?.target;
          const chip = target?.closest?.('button[data-bus-id]');
          const member = groupBusesRef.current.find((candidate) => candidate.id === chip?.dataset.busId);
          if (member) onSelect(member);
        } }}
      >
        {/* Tooltip permanence is a bind-time Leaflet option. Rebind only the
            overlay when switching modes, never the keyed bus Marker itself. */}
        {tooltipBus && <BusMarkerTooltip key={isPinned ? 'pinned' : 'preview'} bus={tooltipBus} nowMs={nowMs} position={markerPosition} calloutOffset={calloutOffset} pinned={isPinned} previewOpen={Boolean(groupBuses && hoveredGroupBusId)} onClose={onClosePopup} />}
      </Marker>
    </>
  );
}

export function ZoomAwareBusMarkers({ buses, selectedBusId, onSelect, nowMs, pinSelectedBusSignal = 0, knownBusIds = buses.map((bus) => bus.id) }) {
  const map = useMap();
  const [pinnedBusId, setPinnedBusId] = useState(null);
  const previousSelection = useRef(selectedBusId);
  const pendingSelectorPinRef = useRef(null);
  const disposed = useRef(false);
  const [zoom, setZoom] = useState(() => {
    const initialZoom = typeof map.getZoom === 'function' ? map.getZoom() : BUS_MARKER_BASE_ZOOM;
    return Number.isFinite(Number(initialZoom)) ? Number(initialZoom) : BUS_MARKER_BASE_ZOOM;
  });
  const [mapViewRevision, setMapViewRevision] = useState(0);

  useEffect(() => {
    disposed.current = false;
    const unload = () => { disposed.current = true; pendingSelectorPinRef.current = null; setPinnedBusId(null); };
    map.on?.('unload', unload);
    return () => { disposed.current = true; map.off?.('unload', unload); };
  }, [map]);

  const busIdsKey = buses.map((bus) => bus.id).join('|');
  const knownBusIdsKey = knownBusIds.join('|');
  useEffect(() => {
    const selectionChanged = previousSelection.current !== selectedBusId;
    previousSelection.current = selectedBusId;
    if (pendingSelectorPinRef.current && pendingSelectorPinRef.current !== selectedBusId) pendingSelectorPinRef.current = null;
    if (pinnedBusId && !buses.some((bus) => bus.id === pinnedBusId)) setPinnedBusId(null);
    // A chooser selection transfers an already pinned card. Closing the card
    // stays independent of selection and does not automatically reopen it.
    else if (pinnedBusId && selectionChanged && selectedBusId && buses.some((bus) => bus.id === selectedBusId)) setPinnedBusId(selectedBusId);
  }, [selectedBusId, pinnedBusId, busIdsKey]);

  useEffect(() => {
    if (pinSelectedBusSignal <= 0) return;
    if (!selectedBusId || !knownBusIds.includes(selectedBusId)) {
      pendingSelectorPinRef.current = null;
      setPinnedBusId(null);
    } else if (buses.some((bus) => bus.id === selectedBusId)) {
      pendingSelectorPinRef.current = null;
      setPinnedBusId(selectedBusId);
    } else {
      // Keep the pin request pending for a selected no-fix bus. If Realtime
      // later supplies its first valid coordinates, its marker card opens.
      pendingSelectorPinRef.current = selectedBusId;
      setPinnedBusId(null);
    }
  }, [pinSelectedBusSignal]);

  useEffect(() => {
    const pendingBusId = pendingSelectorPinRef.current;
    if (!pendingBusId) return;
    if (pendingBusId !== selectedBusId || !knownBusIds.includes(pendingBusId)) {
      pendingSelectorPinRef.current = null;
      return;
    }
    if (buses.some((bus) => bus.id === pendingBusId)) {
      pendingSelectorPinRef.current = null;
      setPinnedBusId(pendingBusId);
    }
  }, [busIdsKey, knownBusIdsKey, selectedBusId]);

  useEffect(() => {
    if (typeof map.on !== 'function' || typeof map.off !== 'function') return undefined;
    const handleViewChange = () => {
      const nextZoom = map.getZoom();
      if (Number.isFinite(Number(nextZoom))) setZoom(Number(nextZoom));
      setMapViewRevision((revision) => revision + 1);
    };
    map.on('zoomend', handleViewChange);
    map.on('moveend', handleViewChange);
    map.on('resize', handleViewChange);
    return () => {
      map.off('zoomend', handleViewChange);
      map.off('moveend', handleViewChange);
      map.off('resize', handleViewChange);
    };
  }, [map]);

  const markerOffsets = useMemo(
    () => getNearbyBusMarkerOffsets(buses, map, zoom),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view revision invalidates pixel projection after map events.
    [buses, map, zoom, mapViewRevision],
  );

  const iconKey = buses.map((bus) => `${bus.id}:${bus.status}:${getMarkerGpsFreshness(bus, nowMs).status}:${bus.id === selectedBusId}:${markerOffsets.get(bus.id)?.label || ''}:${markerOffsets.get(bus.id)?.sharedGroupKey || ''}`).join('|');
  const icons = useMemo(() => new window.Map(buses.map((bus) => [
    bus.id,
    createBusMarkerIcon(bus, bus.id === selectedBusId, zoom, nowMs, markerOffsets.get(bus.id)?.label || ''),
  ])), [iconKey, zoom]);
  const sharedIcons = useMemo(() => {
    const result = new window.Map();
    buses.forEach((bus) => {
      const offset = markerOffsets.get(bus.id);
      if (!offset?.sharedGroupKey || result.has(offset.sharedGroupKey)) return;
      const members = offset.sharedGroupBusIds.map((id) => buses.find((candidate) => candidate.id === id));
      result.set(offset.sharedGroupKey, createSharedBusMarkerIcon(members, selectedBusId, zoom, nowMs));
    });
    return result;
  }, [iconKey, zoom]);

  const renderedGroups = new Set();
  return buses.map((bus) => {
    const offset = markerOffsets.get(bus.id);
    let groupBuses = null;
    if (offset?.sharedGroupKey) {
      if (renderedGroups.has(offset.sharedGroupKey)) return null;
      renderedGroups.add(offset.sharedGroupKey);
      groupBuses = offset.sharedGroupBusIds.map((id) => buses.find((candidate) => candidate.id === id));
    }
    const owner = groupBuses ? groupBuses[0] : bus;
    return (
    <AnimatedBusMarker
      key={groupBuses ? `shared:${offset.sharedGroupKey}` : bus.id}
      bus={owner}
      groupBuses={groupBuses}
      groupPinnedBusId={pinnedBusId}
      icon={groupBuses ? sharedIcons.get(offset.sharedGroupKey) : icons.get(bus.id)}
      isSelected={groupBuses ? groupBuses.some((member) => member.id === selectedBusId) : bus.id === selectedBusId}
      isPinned={groupBuses ? groupBuses.some((member) => member.id === pinnedBusId) : bus.id === pinnedBusId}
      onClosePopup={() => { pendingSelectorPinRef.current = null; setPinnedBusId(null); }}
      onSelect={(selectedBus) => {
        if (disposed.current || map._loaded === false) return;
        pendingSelectorPinRef.current = null;
        setPinnedBusId(selectedBus.id);
        // A fanned-out marker has an unambiguous hit target: select that exact
        // bus instead of reopening the legacy overlap chooser.
        onSelect(selectedBus, [selectedBus]);
      }}
      nowMs={nowMs}
      pixelOffset={groupBuses ? null : offset || null}
    />
  );
  });
}

function getFleetSelectorLabel(bus) {
  const candidates = [bus?.plateNumber, bus?.busCode, bus?.deviceName, bus?.name];
  const label = candidates.find((value) => typeof value === 'string' && value.trim());
  return label?.trim() || (bus?.id ? `Bus ${bus.id}` : 'Unnamed bus');
}

function getFleetSelectorGpsStatus(bus, nowMs) {
  return getBusCoordinates(bus) ? getMarkerGpsFreshness(bus, nowMs).status : 'No Location';
}

function FleetBusSelector({ buses, selectedBusId, nowMs, onSelectBus }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef(null);
  const triggerRef = useRef(null);
  const selectableBuses = buses.filter((bus) => bus?.id && bus.isPlaceholder !== true && bus.isArchived !== true);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    const onPointerDown = (event) => {
      if (!selectorRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen]);

  const selectBus = (bus) => {
    onSelectBus(bus);
    setIsOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="relative" ref={selectorRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'fleet-bus-selector-popover' : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F] sm:min-h-9"
      >
        <BusFront size={16} aria-hidden="true" />
        <span>Buses</span>
        <span className="text-xs font-semibold text-slate-400">{selectableBuses.length}</span>
        <ChevronDown size={14} aria-hidden="true" className={isOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {isOpen && (
        <div id="fleet-bus-selector-popover" className="fleet-bus-selector-popover absolute right-0 top-full z-[2000] mt-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl" role="region" aria-label="Available buses">
          <div className="px-2 pb-2 pt-1 text-xs font-extrabold uppercase tracking-wide text-slate-500">Select a bus</div>
          {selectableBuses.length === 0 ? (
            <p className="px-2 py-3 text-sm font-medium text-slate-500">No buses available.</p>
          ) : selectableBuses.map((bus) => {
            const label = getFleetSelectorLabel(bus);
            const gpsStatus = getFleetSelectorGpsStatus(bus, nowMs);
            return (
              <button
                type="button"
                key={bus.id}
                aria-label={`Select bus ${label}, GPS ${gpsStatus}`}
                aria-pressed={bus.id === selectedBusId}
                onClick={() => selectBus(bus)}
                className={`flex min-h-[52px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F] ${bus.id === selectedBusId ? 'bg-[#FFF8F8] ring-1 ring-[#E9C3C8]' : ''}`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: getBusMarkerIdentityColor(bus) }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold text-slate-900">{label}</span>
                  {visibleRouteName(bus.routeName) && <span className="block truncate text-[11px] font-medium text-slate-500">{visibleRouteName(bus.routeName)}</span>}
                </span>
                <StatusBadge value={gpsStatus} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LeafletMapPanel({
  selectedBus, selectedTrip, onSelect, monitoredBuses, routeSafeRadiusM,
  selectedPlaceholderBus, onSelectPlaceholderBus, onCenterBus, resizeSignal, autoCenterKey, showDetails = false, compact = false, nowMs, showFullMapAction = false, onNavigate,
}) {
  const [centerSignal, setCenterSignal] = useState(0);
  const [centerAllSignal, setCenterAllSignal] = useState(0);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [pinSelectedBusSignal, setPinSelectedBusSignal] = useState(0);
  const mapRef = useRef(null);
  // No assigned-route overlay or routing request on either fleet map. Bus GPS
  // markers/centering remain live; this does not change route-monitoring data.
  const selectedCoordinates = getBusCoordinates(selectedBus);
  const selectedLiveSpeed = rawGpsSpeed(selectedBus?.gps);
  const selectedGpsFreshness = getGpsFreshness(selectedBus, nowMs);
  const mapCenter = selectedCoordinates
    ? [selectedCoordinates.lat, selectedCoordinates.lng]
    : [fpipToLimaWaypoints[2].lat, fpipToLimaWaypoints[2].lng];
  const radiusCenter = mapCenter;
  const markerBuses = monitoredBuses.filter(isMarkerEligible);

  const centerSelectedBus = () => { if (!selectedBus) return; setCenterSignal((v) => v + 1); onCenterBus(); };
  const selectBusFromFleet = (bus) => {
    setCenterSignal((value) => value + 1);
    setPinSelectedBusSignal((value) => value + 1);
    onSelect(bus, [], { source: 'fleet-selector' });
  };

  useEffect(() => {
    if (autoCenterKey && monitoredBuses.length > 0) setCenterAllSignal((value) => value + 1);
  }, [autoCenterKey, monitoredBuses.length]);

  return (
    <section className={`map-card flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-sm ${compact ? 'h-auto min-h-0 lg:h-full' : 'min-h-[540px]'}`}>
      <div className="map-card-header flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-[15px] font-extrabold text-slate-900">Fleet Location Map</h2>
        <div className="map-actions flex flex-wrap items-center gap-2">
          <button title="Center selected bus" aria-label="Center selected bus" disabled={!selectedBus} onClick={centerSelectedBus} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"><Navigation size={16} /></button>
          <button title="Center all buses" aria-label="Center all buses" onClick={() => setCenterAllSignal((v) => v + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"><Map size={16} /></button>
          <button title="Reset map view" aria-label="Reset map view" onClick={() => setResetViewSignal((v) => v + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"><RefreshCcw size={16} /></button>
          <FleetBusSelector buses={monitoredBuses} selectedBusId={selectedBus?.id} nowMs={nowMs} onSelectBus={selectBusFromFleet} />
          {showFullMapAction && <button onClick={() => onNavigate('map')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#8E1F2F] px-3 text-sm font-extrabold text-white transition hover:bg-[#B22B34]"><Map size={15} /> View Full Map</button>}
        </div>
      </div>
      <div className={`map-wrapper map-container relative overflow-hidden bg-slate-100 ${compact ? 'h-[400px] min-h-0 flex-none sm:h-[440px] lg:h-auto lg:min-h-[440px] lg:flex-1' : 'h-[560px] xl:h-[690px]'}`}>
        <MapContainer ref={mapRef} center={mapCenter} zoom={12} scrollWheelZoom className="fleet-map h-full w-full" style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' />
          <MapViewportController
            mapRef={mapRef} selectedBus={selectedBus} visiblePoints={markerBuses.map(getBusCoordinates).filter(Boolean)}
            routePoints={[]}
            centerBusSignal={centerSignal} centerAllSignal={centerAllSignal}
            resetViewSignal={resetViewSignal} resizeSignal={resizeSignal}
          />
          <FitFleetBounds buses={markerBuses} />
          <AnimatedRadiusCircle center={radiusCenter} radius={routeSafeRadiusM} />
          
          <ZoomAwareBusMarkers buses={markerBuses} selectedBusId={selectedBus?.id} onSelect={onSelect} nowMs={nowMs} pinSelectedBusSignal={pinSelectedBusSignal} knownBusIds={monitoredBuses.map((bus) => bus.id)} />
        </MapContainer>
      </div>
      {showDetails && (selectedBus ? (
        <div className="grid gap-x-5 gap-y-4 border-t border-slate-100 bg-white p-5 sm:grid-cols-2 xl:grid-cols-5">
          <div className="min-w-0"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Vehicle</div><div className="mt-1 truncate text-base font-extrabold text-slate-900">{selectedBus.plateNumber || 'No plate assigned'}</div><div className="mt-1 truncate text-xs font-medium text-slate-500">Bus ID: {selectedBus.id}</div></div>
          <div className="min-w-0"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Status & Trip</div><div className="mt-1"><BusStatusBadge status={selectedBus.status} /></div><div className="mt-2 text-sm font-semibold text-slate-600">{[selectedTrip?.status || 'No active trip', visibleRouteName(selectedTrip?.routeLabel || selectedBus.routeName)].filter(Boolean).join(' · ')}</div></div>
          <div className="min-w-0"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Tracking</div><div className="mt-1 text-sm font-extrabold text-slate-800">{Number.isFinite(selectedLiveSpeed) ? `${selectedLiveSpeed} km/h` : 'Speed unavailable'}</div><div className="mt-1 text-xs font-medium text-slate-500">{selectedCoordinates ? `${selectedCoordinates.lat}, ${selectedCoordinates.lng}` : 'Location not available'}</div></div>
          <div className="min-w-0" title={formatGpsLastUpdate(selectedGpsFreshness)}><div className="text-xs font-bold uppercase tracking-wide text-slate-400">GPS</div><div className="mt-1 text-sm font-extrabold text-slate-800">{selectedGpsFreshness.status}</div><div className="mt-1 text-xs font-medium text-slate-500">{formatCompactGpsAge(selectedGpsFreshness.ageMs)}</div></div>
          <div className="min-w-0"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Bus Record Updated</div><div className="mt-1 text-sm font-semibold text-slate-700">{formatRecordTimestamp(selectedBus.updatedAt)}</div>{selectedTrip?.status === 'Active' && <div className="mt-1 text-xs font-medium text-slate-500">Trip started {selectedTrip.date} · {selectedTrip.time}</div>}</div>
        </div>
      ) : <div className="border-t border-slate-100 bg-white p-6"><EmptyState compact icon={Navigation} title="Select a bus on the map to view details" message="Click a vehicle marker to view live information." /></div>)}
    </section>
  );
}

/* ─── Active Alerts ──────────────────────────── */

function getAlertDisplayTitle(alert) {
  const title = alert.title || 'Fleet alert';
  const busIdentifier = alert.busNumber || alert.busId;
  return busIdentifier && title.startsWith(`${busIdentifier}:`)
    ? title.slice(busIdentifier.length + 1).trim()
    : title;
}

function ActiveAlertsPanel({ activeAlerts, buses, onAcknowledge, onNavigate }) {
  const priority = { Critical: 0, Warning: 1, Information: 2 };
  const visibleAlerts = [...activeAlerts].sort((a, b) => priority[getAlertSeverity(a)] - priority[getAlertSeverity(b)] || b.timestampMs - a.timestampMs).slice(0, 3);

  return (
    <section className="flex min-h-0 flex-col rounded-[18px] border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="w-full">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-extrabold text-slate-900">Active Alerts</h2>
          <button onClick={() => onNavigate({ page: 'alerts', status: 'active' })} className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 transition hover:text-[#8E1F2F]">View all <ArrowRight size={15} /></button>
        </div>
        <div className="flex-1">
          {visibleAlerts.length === 0 ? (
            <EmptyState compact icon={Bell} title="No active alerts" message="Alerts requiring action will appear here." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {visibleAlerts.map((alert) => {
                const matchingBus = buses.find((bus) => bus.id === alert.busNumber || bus.id === alert.busId);
                const busLabel = matchingBus?.plateNumber || alert.plateNumber || alert.busNumber || 'Fleet';
                return (
                  <article key={alert.id} className="flex min-h-[142px] min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50/40 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <StatusBadge value={getAlertSeverity(alert)} />
                      <div title={formatTimestamp(alert.timestampMs)} className="shrink-0 text-xs font-medium text-slate-400">{getRelativeTime(alert.timestampMs)}</div>
                    </div>
                    <div className="mt-3 min-w-0">
                      <h3 className="truncate text-sm font-extrabold text-slate-900">{getAlertDisplayTitle(alert)}</h3>
                      <div title={matchingBus?.id || alert.busNumber} className="mt-1 truncate text-xs font-bold text-slate-500">{busLabel}</div>
                    </div>
                    <p className="mt-2 min-h-10 text-xs font-medium leading-5 text-slate-500">{alert.description}</p>
                    {isUnacknowledgedAlert(alert) && <button title="Acknowledge alert" aria-label={`Acknowledge ${getAlertDisplayTitle(alert)}`} onClick={() => onAcknowledge(alert)} className="mt-auto inline-flex w-fit items-center gap-1 pt-2 text-xs font-bold text-slate-500 transition hover:text-[#8E1F2F]"><ShieldCheck size={14} /> Acknowledge</button>}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─── Sidebar ───────────────────────────────────── */

const navigationItems = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['map', 'Live Map', Map],
  ['live-camera', 'Live Camera View', Camera],
  ['vehicle-condition', 'Vehicle Condition', Activity],
  ['alerts', 'Alert Center', Bell],
  ['records', 'Records', FileClock],
  ['settings', 'Settings', Settings],
  ['logout', 'Logout', LogOut],
];

function Sidebar({ activePage, onNavigate, open, onToggle, onLogout, alertCount }) {
  const mainNav = navigationItems.filter(item => item[0] !== 'logout');
  const logoutItem = navigationItems.find(item => item[0] === 'logout');
  const LogoutIcon = logoutItem ? logoutItem[2] : LogOut;
  const closeTimer = useRef(null);
  const showSidebar = () => { if (closeTimer.current) clearTimeout(closeTimer.current); onToggle(true); };
  const hideSidebar = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => onToggle(false), 280); };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="fixed left-4 top-4 z-[1200] grid h-10 w-10 place-items-center rounded-xl bg-[#7A1F2B] text-white shadow-lg shadow-[#7A1F2B]/25 lg:hidden"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      <div className={`sidebar-trigger-zone hidden lg:block ${open ? 'is-disabled' : ''}`} onMouseEnter={showSidebar} aria-hidden="true" />
      {open && <button type="button" aria-label="Close" onClick={() => onToggle(false)} className="fixed inset-0 z-[1050] bg-slate-950/35 lg:hidden" />}
      <aside onMouseEnter={showSidebar} onMouseLeave={hideSidebar} className={`sidebar-shell sidebar ${open ? 'is-open' : 'is-collapsed'} fixed inset-y-0 left-0 z-[2000] flex flex-col text-white shadow-xl`}>
        <div className="sidebar-brand mb-5">
          <img src={CENTRABUS_LOCKED_LOGO_SRC} alt="CentraBus" />
        </div>
        <div className="sidebar-section-label">Monitoring</div>
        <nav className="sidebar-nav flex-1 overflow-y-auto">
          {mainNav.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => {
                onNavigate(id);
                if (window.innerWidth < 1024) onToggle(false);
              }}
              title={!open ? label : undefined}
              className={`sidebar-item focus-visible:ring-2 focus-visible:ring-[#F2C14E] outline-none ${activePage === id ? 'active' : ''}`}
            >
              <span className="sidebar-item-icon"><Icon size={20} strokeWidth={2.15} /></span>
              <span className="sidebar-item-label">{label}</span>
              {id === 'alerts' && alertCount > 0 && (
                <span className="sidebar-badge">{alertCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            onClick={() => {
              onLogout();
              if (window.innerWidth < 1024) onToggle(false);
            }}
            className="sidebar-item sidebar-item-logout focus-visible:ring-2 focus-visible:ring-[#F2C14E] outline-none"
          >
            <span className="sidebar-item-icon"><LogoutIcon size={20} strokeWidth={2.15} /></span>
            <span className="sidebar-item-label">{logoutItem ? logoutItem[1] : 'Logout'}</span>
          </button>
          <div className="sidebar-status">
            <span className="sidebar-status-dot" /> System Online
          </div>
        </div>
      </aside>
    </>
  );
}

export function useAlertNotification(alerts) {
  const [popupAlertId, setPopupAlertId] = useState(null);
  const shown = useRef(new window.Map());
  useEffect(() => {
    const active = alerts.filter(isUnacknowledgedAlert);
    const activeIds = new Set(active.map((alert) => alert.id));
    // End of an episode allows a genuinely recurring alert to notify again.
    shown.current.forEach((_, id) => { if (!activeIds.has(id)) shown.current.delete(id); });
    const changed = active.find((alert) => {
      const signature = JSON.stringify([getAlertSeverity(alert), getAlertStatus(alert), getAlertDisplayTitle(alert)]);
      return shown.current.get(alert.id) !== signature;
    });
    if (changed) {
      shown.current.set(changed.id, JSON.stringify([getAlertSeverity(changed), getAlertStatus(changed), getAlertDisplayTitle(changed)]));
      setPopupAlertId(changed.id);
    } else setPopupAlertId((current) => activeIds.has(current) ? current : null);
  }, [alerts]);
  return { popupAlertId, dismiss: () => setPopupAlertId(null) };
}

export function AlertNotification({ alert: latestAlert, buses = [], onViewMap, onReview, onAcknowledge, onDismiss }) {
  const severity = getAlertSeverity(latestAlert);
  const matchingBus = buses.find((bus) => bus.id === latestAlert.busNumber || bus.id === latestAlert.busId);
  const vehicleLabel = matchingBus?.plateNumber || latestAlert.plateNumber || 'Fleet vehicle';
  const isCritical = severity === 'Critical';
  const isWarning = severity === 'Warning';
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (isRetiredTirePressureAlert(latestAlert) || isCritical || hovered) return undefined;
    const timer = setTimeout(onDismiss, isWarning ? 10000 : 6000);
    return () => clearTimeout(timer);
  }, [latestAlert, isCritical, isWarning, hovered, onDismiss]);

  if (isRetiredTirePressureAlert(latestAlert)) return null;

  return (
    <aside onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className={`fixed right-4 top-24 z-[2500] w-[calc(100%-2rem)] max-w-[320px] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border bg-white shadow-xl shadow-[#7A1F2B]/15 ${isCritical ? 'border-[#E9B9BF]' : isWarning ? 'border-[#F2D98C]' : 'border-[#E9C3C8]'}`} role="alert" aria-live="assertive">
      <div className={`flex items-center gap-2 px-3 py-2 ${isCritical ? 'bg-[#FBEDEE] text-[#8E1F2F]' : isWarning ? 'bg-[#FFF7DB] text-[#7B5400]' : 'bg-[#FBEDEE] text-[#7A1F2B]'}`}>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${isCritical ? 'bg-[#B22B34]' : isWarning ? 'bg-[#D9A404]' : 'bg-[#8E1F2F]'}`}><TriangleAlert size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold" title={vehicleLabel}>{vehicleLabel}</div>
          <div className="text-[11px] font-semibold" title={formatTimestamp(latestAlert.timestampMs)}>{getRelativeTime(latestAlert.timestampMs)}</div>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="rounded-lg p-1.5 transition hover:bg-white/60"><X size={18} /></button>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0 break-words text-sm font-extrabold text-slate-900">{getAlertDisplayTitle(latestAlert)}</div><StatusBadge value={severity} /></div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onReview} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50">Review Alert</button>
          <button type="button" onClick={onAcknowledge} className={`rounded-lg px-2.5 py-1.5 text-xs font-extrabold text-white ${isCritical ? 'bg-[#B22B34]' : isWarning ? 'bg-[#9A6800]' : 'bg-[#8E1F2F]'}`}>Acknowledge</button>
          <button type="button" onClick={onViewMap} className="rounded-lg px-1 py-1.5 text-xs font-bold text-slate-600 transition hover:text-slate-900">View on Map</button>
        </div>
      </div>
    </aside>
  );
}

/* ─── Pages ─────────────────────────────────────── */


export function AlertsPage({ alerts, buses, onUpdateAlert, initialCategory, initialStatus, selectedAlertId }) {
  const [vehicle, setVehicle] = useState('All');
  const [category, setCategory] = useState('All');
  const [severity, setSeverity] = useState('All');
  const [status, setStatus] = useState('All');
  const [sort, setSort] = useState('Newest');
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [acknowledgingId, setAcknowledgingId] = useState('');
  const [isAcknowledgingAll, setIsAcknowledgingAll] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  useEffect(() => {
    const categoryValue = initialCategory ? initialCategory.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()) : 'All';
    setCategory(categoryValue === 'All' ? 'All' : categoryValue);
    setStatus(initialStatus === 'active' ? 'Active' : 'All');
  }, [initialCategory, initialStatus]);
  useEffect(() => {
    if (selectedAlertId) setSelectedAlert(alerts.find((alert) => alert.id === selectedAlertId && !isRetiredTirePressureAlert(alert)) || null);
    else setSelectedAlert((current) => isRetiredTirePressureAlert(current) ? null : current);
  }, [selectedAlertId, alerts]);
  const filteredAlerts = alerts.filter((alert) => !isRetiredTirePressureAlert(alert) && (vehicle === 'All' || alert.busNumber === vehicle || alert.busId === vehicle) && (category === 'All' || getAlertCategory(alert) === category) && (severity === 'All' || getAlertSeverity(alert) === severity) && (status === 'All' || (status === 'Active' ? isActiveIssue(alert) : getAlertStatus(alert) === status))).sort((a, b) => sort === 'Highest severity' ? ({ Critical: 0, Warning: 1, Information: 2 }[getAlertSeverity(a)] - { Critical: 0, Warning: 1, Information: 2 }[getAlertSeverity(b)]) : sort === 'Oldest' ? a.timestampMs - b.timestampMs : b.timestampMs - a.timestampMs);
  const selectedAlertBus = selectedAlert ? buses.find((bus) => bus.id === selectedAlert.busNumber || bus.id === selectedAlert.busId) : null;
  const filtersActive = vehicle !== 'All' || category !== 'All' || severity !== 'All' || status !== 'All';
  const acknowledge = async (alert) => {
    if (!isUnacknowledgedAlert(alert) || acknowledgingId || isAcknowledgingAll) return;
    setAcknowledgingId(alert.id);
    setFeedback('');
    setFeedbackIsError(false);
    try {
      await Promise.resolve(onUpdateAlert(alert.id, { workflowStatus: 'Acknowledged', acknowledgedBy: 'Administrator', acknowledgedAt: Date.now() }));
      setFeedback('Alert acknowledged in the current dashboard session.');
    } catch {
      setFeedbackIsError(true);
      setFeedback('Unable to acknowledge this alert. Please try again.');
    } finally {
      setAcknowledgingId('');
    }
  };
  const acknowledgeFiltered = async () => {
    const candidates = filteredAlerts.filter(isUnacknowledgedAlert);
    if (!candidates.length || isAcknowledgingAll || !window.confirm(`Acknowledge ${candidates.length} displayed alert${candidates.length === 1 ? '' : 's'}?`)) return;
    setIsAcknowledgingAll(true);
    setFeedback('');
    setFeedbackIsError(false);
    try {
      await Promise.all(candidates.map((alert) => Promise.resolve(onUpdateAlert(alert.id, { workflowStatus: 'Acknowledged', acknowledgedBy: 'Administrator', acknowledgedAt: Date.now() }))));
      setFeedback(`${candidates.length} alert${candidates.length === 1 ? '' : 's'} acknowledged in the current dashboard session.`);
    } catch {
      setFeedbackIsError(true);
      setFeedback('Unable to acknowledge all displayed alerts. Please try again.');
    } finally {
      setIsAcknowledgingAll(false);
    }
  };
  return <section className="flex flex-col rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs font-bold text-slate-500">Vehicle<select aria-label="Filter alerts by vehicle" value={vehicle} onChange={(event) => setVehicle(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"><option value="All">All vehicles</option>{buses.map((bus) => <option key={bus.id} value={bus.id}>{bus.plateNumber || 'No plate assigned'} — {bus.id}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-500">Category<select aria-label="Filter alerts by category" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"><option value="All">All categories</option><option>Vehicle Condition</option><option>Route</option><option>Connectivity</option><option>System</option></select></label>
        <label className="text-xs font-bold text-slate-500">Severity<select aria-label="Filter alerts by severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"><option value="All">All severities</option><option>Critical</option><option>Warning</option><option>Information</option></select></label>
        <label className="text-xs font-bold text-slate-500">Status<select aria-label="Filter alerts by status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"><option value="All">All statuses</option><option value="Active">Active (not resolved)</option><option>New</option><option>Acknowledged</option><option>Investigating</option><option>Resolved</option></select></label>
        <label className="text-xs font-bold text-slate-500">Sort<select aria-label="Sort alerts" value={sort} onChange={(e) => setSort(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"><option>Newest</option><option>Oldest</option><option>Highest severity</option></select></label>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={acknowledgeFiltered} disabled={isAcknowledgingAll || !filteredAlerts.some(isUnacknowledgedAlert)} className="rounded-xl bg-[#8E1F2F] px-4 py-2 text-sm font-extrabold text-white transition hover:bg-[#B22B34] disabled:cursor-not-allowed disabled:opacity-50">{isAcknowledgingAll ? 'Acknowledging…' : filtersActive ? 'Acknowledge Filtered Alerts' : 'Acknowledge All'}</button>
      </div>
    </div>
    {feedback && <div role={feedbackIsError ? 'alert' : 'status'} className={`mb-4 rounded-xl border px-3 py-2 text-sm font-semibold ${feedbackIsError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{feedback}</div>}
    <div className="overflow-x-auto rounded-xl border border-slate-100"><table className="w-full min-w-[920px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr>{['Time', 'Vehicle', 'Category', 'Severity', 'Alert', 'Status', 'Action'].map((columnLabel) => <th key={columnLabel} className="px-4 py-3 font-extrabold">{columnLabel}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filteredAlerts.length === 0 ? <tr><td colSpan="7" className="p-8"><EmptyState compact title="No alerts match these filters." message="Adjust or clear one or more filters." /></td></tr> : filteredAlerts.map((alert) => { const matchingBus = buses.find((bus) => bus.id === alert.busNumber || bus.id === alert.busId); return <tr key={alert.id} className="transition hover:bg-slate-50"><td title={formatTimestamp(alert.timestampMs)} className="px-4 py-3 font-medium text-slate-700">{formatTimestamp(alert.timestampMs)}</td><td className="px-4 py-3"><div className="font-extrabold text-slate-900">{matchingBus?.plateNumber || 'No plate assigned'}</div><div className="mt-0.5 max-w-36 truncate text-xs font-medium text-slate-500">{alert.busNumber}</div></td><td className="px-4 py-3"><StatusBadge value={getAlertCategory(alert)} /></td><td className="px-4 py-3"><StatusBadge value={getAlertSeverity(alert)} /></td><td className="px-4 py-3 font-bold text-slate-700">{getAlertDisplayTitle(alert)}</td><td className="px-4 py-3"><StatusBadge value={getAlertStatus(alert)} /></td><td className="px-4 py-3"><div className="flex gap-3"><button type="button" onClick={() => setSelectedAlert(alert)} className="rounded-md px-1 font-bold text-slate-600 hover:text-[#8E1F2F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]">View</button>{isUnacknowledgedAlert(alert) && <button type="button" disabled={acknowledgingId === alert.id || isAcknowledgingAll} onClick={() => acknowledge(alert)} className="rounded-md px-1 font-bold text-[#8E1F2F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F] disabled:opacity-50">{acknowledgingId === alert.id ? 'Acknowledging…' : 'Acknowledge'}</button>}</div></td></tr>; })}</tbody></table></div>
    {selectedAlert && <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 p-4"><div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-6"><div><div className="mb-2 flex gap-2"><StatusBadge value={getAlertSeverity(selectedAlert)} /><StatusBadge value={getAlertStatus(selectedAlert)} /></div><h3 className="text-xl font-extrabold text-slate-900">{getAlertDisplayTitle(selectedAlert)}</h3><p className="mt-1 text-sm font-extrabold text-slate-700">{selectedAlertBus?.plateNumber || 'No plate assigned'}</p><p className="mt-0.5 text-xs font-medium text-slate-500">Bus ID: {selectedAlert.busNumber} · {formatTimestamp(selectedAlert.timestampMs)}</p></div><button aria-label="Close alert details" onClick={() => setSelectedAlert(null)} className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-[#FBEDEE]"><X size={18} /></button></div><div className="space-y-4 p-6"><p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-relaxed text-slate-700">{selectedAlert.description}</p><div className="grid grid-cols-2 gap-3 text-sm"><Info label="Category" value={getAlertCategory(selectedAlert)} /><Info label="Acknowledged" value={selectedAlert.acknowledgedAt ? `${selectedAlert.acknowledgedBy} · ${formatTimestamp(selectedAlert.acknowledgedAt)}` : 'Not yet'} /></div></div><div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 p-5"><button type="button" onClick={() => setSelectedAlert(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Close</button>{isUnacknowledgedAlert(selectedAlert) && <button type="button" disabled={acknowledgingId === selectedAlert.id} onClick={async () => { await acknowledge(selectedAlert); setSelectedAlert({ ...selectedAlert, workflowStatus: 'Acknowledged', acknowledgedBy: 'Administrator', acknowledgedAt: Date.now() }); }} className="rounded-xl border border-[#E9C3C8] bg-white px-4 py-2 text-sm font-extrabold text-[#8E1F2F] hover:bg-[#FBEDEE] disabled:opacity-50">{acknowledgingId === selectedAlert.id ? 'Acknowledging…' : 'Acknowledge'}</button>}<button type="button" onClick={() => { onUpdateAlert(selectedAlert.id, { workflowStatus: 'Resolved', resolvedAt: Date.now() }); setSelectedAlert(null); }} className="rounded-xl bg-[#7A1F2B] px-4 py-2 text-sm font-extrabold text-white hover:bg-[#8E1F2F]">Resolve</button></div></div></div>}
  </section>;
}

const BUS_REGISTRATION_STATUSES = ['active', 'inactive', 'maintenance', 'offline'];

export function normalizePlateNumber(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function isValidPlateNumber(value) {
  const normalizedPlateNumber = normalizePlateNumber(value);
  return normalizedPlateNumber.length >= 2
    && normalizedPlateNumber.length <= 20
    && /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(normalizedPlateNumber);
}

function getPlateComparisonKey(value) {
  return normalizePlateNumber(value).replace(/\s/g, '');
}

export function hasRegisteredDuplicatePlate(buses, plateNumber, excludedBusId = null) {
  const comparisonKey = getPlateComparisonKey(plateNumber);
  return Boolean(comparisonKey) && buses.some((bus) => (
    bus.id !== excludedBusId
    && bus.isPlaceholder !== true
    && bus.isArchived !== true
    && getPlateComparisonKey(bus.plateNumber) === comparisonKey
  ));
}

export function getValidSelectedBusId(buses, selectedBusId) {
  if (!Array.isArray(buses) || buses.length === 0) return null;
  return buses.some((bus) => bus.id === selectedBusId) ? selectedBusId : null;
}

function BusRegistrationForm() {
  const [plateNumber, setPlateNumber] = useState('');
  const [status, setStatus] = useState('active');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;

    const normalizedPlateNumber = normalizePlateNumber(plateNumber);
    clearMessages();

    if (!normalizedPlateNumber) {
      setError('Plate Number is required.');
      return;
    }
    if (!isValidPlateNumber(normalizedPlateNumber)) {
      setError('Enter a valid Plate Number using letters, numbers, spaces, or hyphens.');
      return;
    }
    if (!BUS_REGISTRATION_STATUSES.includes(status)) {
      setError('Select a valid bus status.');
      return;
    }

    setIsSaving(true);
    try {
      const busReference = await registerBus({ plateNumber: normalizedPlateNumber, status });
      setPlateNumber('');
      setStatus('active');
      setSuccess(`Bus ${busReference.id} registered successfully.`);
    } catch (registrationError) {
      console.error('Unable to register bus:', registrationError.code, registrationError.message);
      setError(
        registrationError.code === 'duplicate-plate'
          ? 'A bus with this Plate Number already exists.'
          : registrationError.code === 'permission-denied'
            ? 'You do not have permission to register buses.'
            : 'Unable to register the bus. Check your connection and try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-[24px] border bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-[15px] font-extrabold">Bus Registration</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Add a bus to the CentraBus fleet.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {success && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{success}</div>}
        <div>
          <label htmlFor="plateNumber" className="mb-1.5 block text-sm font-bold text-slate-700">Plate Number</label>
          <input id="plateNumber" value={plateNumber} onChange={(event) => { setPlateNumber(event.target.value); clearMessages(); }} disabled={isSaving} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#A1262F] focus:ring-2 focus:ring-[#A1262F]/15 disabled:cursor-not-allowed disabled:bg-slate-50" />
        </div>
        <div>
          <label htmlFor="busStatus" className="mb-1.5 block text-sm font-bold text-slate-700">Status</label>
          <select id="busStatus" value={status} onChange={(event) => { setStatus(event.target.value); clearMessages(); }} disabled={isSaving} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#A1262F] focus:ring-2 focus:ring-[#A1262F]/15 disabled:cursor-not-allowed disabled:bg-slate-50">
            {BUS_REGISTRATION_STATUSES.map((value) => <option key={value} value={value}>{getBusStatusLabel(value)}</option>)}
          </select>
        </div>
        <button type="submit" disabled={isSaving} className="w-full rounded-xl bg-[#8E1F2F] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#B22B34] disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? 'Registering Bus…' : 'Register Bus'}</button>
      </form>
    </section>
  );
}

function BusManagement({ buses, status }) {
  const [search, setSearch] = useState('');
  const [editingBus, setEditingBus] = useState(null);
  const [editedPlateNumber, setEditedPlateNumber] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pendingBus, setPendingBus] = useState(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const visibleBuses = buses.filter((bus) => bus.id.toLowerCase().includes(search.toLowerCase()) || (bus.plateNumber || '').toLowerCase().includes(search.toLowerCase()));

  const openEditBus = (bus) => {
    setEditingBus(bus);
    setEditedPlateNumber(bus.plateNumber || '');
    setError('');
    setMessage('');
  };

  const saveEditedBus = async (event) => {
    event.preventDefault();
    if (!editingBus || isSavingEdit) return;
    const normalizedPlateNumber = normalizePlateNumber(editedPlateNumber);
    setError('');
    setMessage('');
    if (!isValidPlateNumber(normalizedPlateNumber)) {
      setError('Enter a valid Plate Number using letters, numbers, spaces, or hyphens.');
      return;
    }
    if (hasRegisteredDuplicatePlate(buses, normalizedPlateNumber, editingBus.id)) {
      setError('A bus with this Plate Number already exists.');
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateBusPlateNumber(editingBus.id, normalizedPlateNumber);
      setMessage(`Plate number updated for Bus ${editingBus.id}.`);
      setEditingBus(null);
      setEditedPlateNumber('');
    } catch (operationError) {
      console.error('Unable to update bus:', operationError.code, operationError.message);
      setError(operationError.code === 'permission-denied'
        ? 'You do not have permission to edit buses.'
        : 'Unable to update the bus. Check your connection and try again.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const removeBus = async () => {
    if (!pendingBus || isRemoving) return;
    setIsRemoving(true); setError(''); setMessage('');
    try {
      await archiveBus(pendingBus.id);
      setMessage(`${pendingBus.plateNumber || pendingBus.id} was archived. Its Bus ID and historical records were retained.`);
      setPendingBus(null);
    } catch (operationError) {
      console.error('Unable to archive bus:', operationError.code, operationError.message);
      setError(operationError.code === 'stale-camera-assignment'
        ? 'The bus and camera assignment records do not match. Correct the camera assignment before archiving this bus.'
        : 'The bus could not be archived. Check your permission or connection and try again.');
    } finally { setIsRemoving(false); }
  };
  return (
    <section className="space-y-4 rounded-[24px] border bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-[15px] font-extrabold">Bus Management</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Manage registered buses in the live fleet and Supabase.</p>
      </div>
      <input
        aria-label="Search registered buses"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search Bus ID or Plate Number"
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[#A1262F]"
      />
      {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</div>}
      {error && !editingBus && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
      <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
        {status === 'loading' ? (
          <p className="p-3 text-sm font-bold text-slate-400">Loading buses…</p>
        ) : status === 'error' ? (
          <p className="p-3 text-sm font-bold text-slate-400">Bus management is currently unavailable.</p>
        ) : visibleBuses.length === 0 ? (
          <p className="p-3 text-sm font-bold text-slate-400">No registered buses yet.</p>
        ) : visibleBuses.map((bus) => (
          <div key={bus.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="min-w-0">
              <div className="font-extrabold text-slate-900">{bus.plateNumber || 'No plate assigned'}</div>
              <div className="mt-1 max-w-64 truncate text-xs font-medium text-slate-500">Bus ID: {bus.id}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BusStatusBadge status={bus.status} />
              <button type="button" onClick={() => openEditBus(bus)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Edit Plate</button>
              <button type="button" onClick={() => { setPendingBus(bus); setError(''); setMessage(''); }} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50">Archive Bus</button>
            </div>
          </div>
        ))}
      </div>

      {editingBus && (
        <div className="fixed inset-0 z-[2500] grid place-items-center bg-slate-950/40 p-4">
          <form onSubmit={saveEditedBus} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-extrabold text-slate-900">Edit Plate Number</h3>
            <p className="mt-2 text-sm font-medium text-slate-600">The permanent Bus ID will not change.</p>
            <span className="mt-2 block text-xs font-medium text-slate-500">Bus ID: {editingBus.id}</span>
            {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
            <label htmlFor="editedPlateNumber" className="mt-4 block text-sm font-bold text-slate-700">Plate Number</label>
            <input
              id="editedPlateNumber"
              autoFocus
              value={editedPlateNumber}
              onChange={(event) => { setEditedPlateNumber(event.target.value); setError(''); }}
              disabled={isSavingEdit}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[#A1262F] disabled:bg-slate-50"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={isSavingEdit} onClick={() => { setEditingBus(null); setError(''); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Cancel</button>
              <button type="submit" disabled={isSavingEdit} className="rounded-lg bg-[#8E1F2F] px-4 py-2 text-sm font-bold text-white hover:bg-[#B22B34] disabled:opacity-60">{isSavingEdit ? 'Saving…' : 'Save Plate Number'}</button>
            </div>
          </form>
        </div>
      )}

      {pendingBus && (
        <div className="fixed inset-0 z-[2500] grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-extrabold text-slate-900">Archive {pendingBus.plateNumber || 'this bus'}?</h3>
            <p className="mt-2 text-sm font-medium text-slate-600">The bus will leave the active fleet, but its permanent Bus ID and historical records will remain in Supabase. Any assigned camera will be unassigned automatically.</p>
            <span className="mt-2 block text-xs font-medium text-slate-500">Bus ID: {pendingBus.id}</span>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={isRemoving} onClick={() => setPendingBus(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Cancel</button>
              <button type="button" disabled={isRemoving} onClick={removeBus} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">{isRemoving ? 'Archiving…' : 'Archive Bus'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsPage({ user, onLogout, buses, busesStatus, gpsByBusId, gpsRealtime, backendPoll, gpsNowMs }) {
  const [preferences, setPreferences] = useState(() => {
    try {
      const savedPreferences = window.localStorage.getItem(NOTIFICATION_PREFERENCES_KEY);
      return savedPreferences
        ? normalizeNotificationPreferences(JSON.parse(savedPreferences))
        : DEFAULT_NOTIFICATION_PREFERENCES;
    } catch {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }
  });
  const [savedPreferences, setSavedPreferences] = useState(preferences);
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' });
  const isDirty = JSON.stringify(preferences) !== JSON.stringify(savedPreferences);
  const setPreference = (key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    setSaveState({ status: 'idle', message: '' });
  };
  const savePreferences = async () => {
    if (!isDirty || saveState.status === 'saving') return;
    setSaveState({ status: 'saving', message: '' });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      window.localStorage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(preferences));
      setSavedPreferences(preferences);
      setSaveState({ status: 'success', message: 'Notification preferences saved on this browser.' });
    } catch {
      setSaveState({ status: 'error', message: 'Unable to save notification preferences in this browser.' });
    }
  };

  return (
    <section className="space-y-4">
      <DeviceSetup authorized={Boolean(user?.id)} wifiService={WIFI_STATUS_SERVICE} gpsByBusId={gpsByBusId}
        gpsRealtime={gpsRealtime} backendPoll={backendPoll} nowMs={gpsNowMs} busesStatus={busesStatus} presenceService={DEVICE_PRESENCE_SERVICE} remoteWifiService={REMOTE_WIFI_SERVICE} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <section className="rounded-[24px] border bg-white p-5 shadow-sm">
          <h2 className="text-[15px] font-extrabold">Administrator Profile</h2>
          <dl className="mt-4 divide-y divide-slate-100">
            <div className="py-3 first:pt-0"><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Email</dt><dd className="mt-1 break-all text-sm font-extrabold text-slate-800">{user.email || 'Not available'}</dd></div>
            <div className="py-3"><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Role</dt><dd className="mt-1 text-sm font-extrabold text-slate-800">Administrator</dd></div>
          </dl>
          <button type="button" onClick={onLogout} className="mt-2 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-50"><LogOut size={16} /> Log out</button>
        </section>

        <section className="rounded-[24px] border bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-[15px] font-extrabold">Alert Notifications</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Choose which alerts this browser should surface.</p>
          </div>
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
            <div className="flex items-center justify-between gap-4 p-3.5"><span className="text-sm font-extrabold text-slate-800">Gauge Panel</span><ToggleSwitch label="Gauge panel notifications" checked={preferences.gaugePanel} onChange={(checked) => setPreference('gaugePanel', checked)} /></div>
            <div className="flex items-center justify-between gap-4 p-3.5"><span className="text-sm font-extrabold text-slate-800">Route Deviations</span><ToggleSwitch label="Route deviation notifications" checked={preferences.routeDeviation} onChange={(checked) => setPreference('routeDeviation', checked)} /></div>
            <div className="flex items-center justify-between gap-4 p-3.5"><span className="text-sm font-extrabold text-slate-800">System</span><ToggleSwitch label="System notifications" checked={preferences.system} onChange={(checked) => setPreference('system', checked)} /></div>
            <div className="flex items-center justify-between gap-4 p-3.5"><span className="text-sm font-extrabold text-slate-800">Sound</span><ToggleSwitch label="Sound notifications" checked={preferences.sound} onChange={(checked) => setPreference('sound', checked)} /></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div aria-live="polite" className={`text-xs font-bold ${saveState.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{saveState.message}</div>
            <button type="button" onClick={savePreferences} disabled={!isDirty || saveState.status === 'saving'} className="rounded-xl bg-[#8E1F2F] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#B22B34] disabled:cursor-not-allowed disabled:opacity-50">{saveState.status === 'saving' ? 'Saving…' : 'Save Settings'}</button>
          </div>
        </section>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,0.65fr)_minmax(0,1.35fr)]">
        <BusRegistrationForm />
        <BusManagement buses={buses} status={busesStatus} />
      </div>
    </section>
  );
}

export function buildActivityRecordsCsv(records = [], buses = []) {
  const busById = new window.Map(buses.map((bus) => [bus.id, bus]));
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const headings = [
    'Timestamp',
    'Plate Number',
    'Bus ID',
    'Category',
    'Latitude',
    'Longitude',
    'Speed (km/h)',
    'Online',
    'GPS Status',
    'Route Status',
    'Distance From Route (m)',
    'Raw Speed (km/h)',
    'Motion Status',
    'Filter State',
    'GPS Quality',
    'Operational Status',
    'Sync Status',
  ];
  const rows = records.map((record) => {
    const bus = busById.get(record.busNumber || record.busId);
    return [
      formatTimestamp(record.timestampMs),
      bus?.plateNumber || 'No plate assigned',
      record.busNumber || record.busId,
      record.category,
      record.latitude,
      record.longitude,
      record.speed,
      record.online === true ? 'Online' : record.online === false ? 'Offline' : 'Unknown',
      record.gpsStatus || record.eventResult || 'Unknown',
      record.routeStatus,
      record.distanceFromRouteM,
      record.rawSpeedKmh,
      record.motionStatus,
      record.filterState,
      record.gpsQuality,
      record.operationalState,
      record.sync,
    ];
  });
  return [headings, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
}

export function FleetHealthCard({ buses, fleetStatus, compact = false }) {
  const health = getFleetHealthCounts(buses);

  if (compact) return <section className="condition-fleet-health" aria-label="Fleet condition summary">
    <header><h2>Fleet health</h2><span>{health.total} buses</span></header>
    {fleetStatus !== 'ready' ? <p>{fleetStatus === 'loading' ? 'Loading…' : 'Unavailable'}</p>
      : <dl>{[['Normal', health.normal, 'normal'], ['Warning', health.warning, 'warning'],
        ['Critical', health.critical, 'critical'], ['No data', health.unknown, 'unknown']].map(([label, count, tone]) =>
        <div key={label}><dt><i className={`condition-fleet-dot is-${tone}`} />{label}</dt><dd>{count}</dd></div>)}</dl>}
  </section>;

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-extrabold text-slate-900">Fleet Health</h2>
      {fleetStatus === 'loading' ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">Loading fleet condition…</p>
      ) : fleetStatus === 'error' ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">Fleet condition is currently unavailable.</p>
      ) : buses.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">No registered buses.</p>
      ) : (
        <div className="mt-3">
          <div className="flex items-end gap-2"><span className="text-2xl font-black leading-none text-slate-900">{health.total}</span><span className="text-sm font-bold text-slate-600">Total buses</span></div>
          <p className="mt-2 text-sm font-semibold text-slate-500">{health.active} Active · {health.inactive} Inactive</p>
          <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-700">
            <div className="flex items-center justify-between"><dt className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />Normal</dt><dd>{health.normal}</dd></div>
            <div className="flex items-center justify-between"><dt className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" />Warning</dt><dd>{health.warning}</dd></div>
            <div className="flex items-center justify-between"><dt className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" />Critical</dt><dd>{health.critical}</dd></div>
            {health.unknown > 0 && <div className="flex items-center justify-between"><dt className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-slate-300" />Awaiting Data</dt><dd>{health.unknown}</dd></div>}
          </dl>
        </div>
      )}
    </section>
  );
}

export function NeedsAttentionCard({ buses, fleetStatus, onNavigate }) {
  const issues = getNeedsAttentionIssues(buses);
  const busesWithConditionData = buses.filter(hasValidatedConditionData).length;
  const busesAwaitingConditionData = buses.length - busesWithConditionData;

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-extrabold text-slate-900">Needs Attention</h2>
      {fleetStatus === 'loading' ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">Loading vehicle issues…</p>
      ) : fleetStatus === 'error' ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">Vehicle issues are currently unavailable.</p>
      ) : buses.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">No vehicle issues to display.</p>
      ) : issues.length === 0 ? (
        <div className={`mt-3 flex items-start gap-2 ${busesWithConditionData > 0 ? 'text-emerald-800' : 'text-slate-600'}`}>
          {busesWithConditionData > 0 ? <ShieldCheck size={18} className="mt-0.5 shrink-0" /> : <Activity size={18} className="mt-0.5 shrink-0" />}
          <div>
            <div className="text-sm font-extrabold">{busesWithConditionData > 0 ? 'No active issues in available readings' : 'Awaiting validated condition data'}</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-500">{busesAwaitingConditionData > 0 ? `${busesAwaitingConditionData} bus${busesAwaitingConditionData === 1 ? '' : 'es'} awaiting validated readings.` : 'Validated vehicle-condition readings are within normal range.'}</div>
          </div>
        </div>
      ) : (
        <div className="mt-2 divide-y divide-slate-100">
          {issues.map((issue) => (
            <article key={issue.id} className="py-3 first:pt-1 last:pb-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2"><TriangleAlert size={15} className={issue.severity === 'Critical' ? 'shrink-0 text-red-600' : 'shrink-0 text-amber-600'} /><span className="truncate text-sm font-extrabold text-slate-900">{issue.plateNumber}</span></div>
                <span className={`shrink-0 text-xs font-extrabold ${issue.severity === 'Critical' ? 'text-red-700' : 'text-amber-700'}`}>{issue.severity}</span>
              </div>
              <div className="mt-1.5 text-sm font-bold text-slate-700">{issue.label}</div>
              <div className="mt-0.5 text-xs font-medium text-slate-500">{issue.reading}{issue.updatedAtMs ? ` · ${getRelativeTime(issue.updatedAtMs)}` : ''}</div>
            </article>
          ))}
        </div>
      )}
      {fleetStatus === 'ready' && buses.length > 0 && <button type="button" onClick={() => onNavigate({ page: 'alerts', category: 'vehicle condition', status: 'active' })} className="mt-3 inline-flex items-center gap-1 border-t border-slate-100 pt-3 text-sm font-bold text-slate-500 transition hover:text-[#8E1F2F]">View all alerts <ArrowRight size={15} /></button>}
    </section>
  );
}

function BusFleetSelector({ buses, fleetStatus, selectedBusId, onSelectBus, compact = false }) {
  const [searchTerm, setSearchTerm] = useState('');

  const sortedBuses = [...buses].sort((a, b) => {
    return a.id.localeCompare(b.id);
  });

  const normalizedSearch = searchTerm.toLowerCase();
  const filteredBuses = sortedBuses.filter((bus) => {
    const plateNumber = bus.plateNumber || 'No plate assigned';
    return bus.id.toLowerCase().includes(normalizedSearch) || plateNumber.toLowerCase().includes(normalizedSearch);
  });

  return (
    <section className={`bus-fleet-panel ${compact ? 'condition-bus-list' : ''} flex min-h-0 flex-col self-start overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm`}>
      <div className="border-b border-slate-100 bg-slate-50/50 p-4">
        <h2 className="mb-3 text-[15px] font-extrabold text-slate-900">Bus Fleet</h2>
        <input 
          type="text" 
          placeholder="Search ID or Plate..." 
          aria-label="Search buses by plate number or Bus ID"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-[#A1262F] focus:ring-1 focus:ring-[#A1262F] transition"
        />
      </div>
      <div className="bus-fleet-list max-h-[38vh] space-y-2.5 overflow-y-auto p-2.5 xl:max-h-[42vh]" role="listbox" aria-label="Select Bus">
        {fleetStatus === 'loading' ? (
          <div className="p-4 text-center text-sm font-bold text-slate-400">Loading bus fleet…</div>
        ) : fleetStatus === 'error' ? (
          <div className="p-4 text-center text-sm font-bold text-slate-400">Bus fleet is currently unavailable.</div>
        ) : buses.length === 0 ? (
          <div className="p-4 text-center text-sm font-bold text-slate-400">No registered buses.</div>
        ) : filteredBuses.length === 0 ? (
          <div className="p-4 text-center text-sm font-bold text-slate-400">No buses match your search.</div>
        ) : filteredBuses.map(bus => (
          <button 
            key={bus.id} 
            onClick={() => onSelectBus(bus)} 
            className={`w-full cursor-pointer rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#A1262F] ${bus.id === selectedBusId ? 'border-[#E9C3C8] bg-[#FFF8F8]' : 'border-transparent hover:border-slate-100 hover:bg-slate-50/80'}`}
            role="option"
            aria-selected={bus.id === selectedBusId}
          >
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <span className="text-base font-extrabold leading-none text-slate-900">{bus.plateNumber || 'No plate assigned'}</span>
              <BusStatusBadge status={bus.status} />
            </div>
            {!compact && <div className="mt-1 truncate text-xs font-medium text-slate-500">Bus ID: {bus.id}</div>}
            {visibleRouteName(bus.routeName) && <div className="mt-0.5 text-xs font-medium text-slate-500">{visibleRouteName(bus.routeName)}</div>}
          </button>
        ))}
      </div>
    </section>
  );
}

export function VehicleConditionPage({ buses, fleetStatus, selectedBus, selectedBusId, onSelectBus, onNavigate, nowMs, frameService = CAMERA_FRAME_SERVICE }) {
  const conditionBus = getVehicleConditionDisplayBus(selectedBus);

  return (
    <div className="vehicle-condition-layout condition-compact-page">
      <aside className="vehicle-condition-sidebar">
        <BusFleetSelector compact buses={buses} fleetStatus={fleetStatus} selectedBusId={selectedBusId} onSelectBus={onSelectBus} />
        <FleetHealthCard compact buses={buses} fleetStatus={fleetStatus} />
      </aside>
      <div className="condition-page-main">
        <BusDetailsPanel compact bus={selectedBus} onNavigate={onNavigate} nowMs={nowMs} />
        <VehicleConditionSummary bus={conditionBus} pageContext="vehicle-condition" onNavigate={onNavigate} frameService={frameService} />
      </div>
    </div>
  );
}

export function useUrlState() {
  const pathPage = { '/live-map': 'map', '/live-camera': 'live-camera', '/alerts': 'alerts', '/vehicle-condition': 'vehicle-condition' };
  const [urlParams, setUrlParams] = useState(() => new URLSearchParams(window.location.search));

  useEffect(() => {
    const handlePopState = () => {
      setUrlParams(new URLSearchParams(window.location.search));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (params, replace = false) => {
    const newParams = new URLSearchParams(window.location.search);
    let changed = false;
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        if (newParams.has(key)) { newParams.delete(key); changed = true; }
      } else {
        if (newParams.get(key) !== String(value)) { newParams.set(key, value); changed = true; }
      }
    }
    const nextPage = params.page || newParams.get('page') || pathPage[window.location.pathname] || 'dashboard';
    const nextPath = { map: '/live-map', 'live-camera': '/live-camera', alerts: '/alerts', 'vehicle-condition': '/vehicle-condition' }[nextPage] || '/';
    if (nextPath !== '/' && newParams.has('page')) { newParams.delete('page'); changed = true; }
    if (changed || window.location.pathname !== nextPath) {
      const qs = newParams.toString();
      const newUrl = nextPath + (qs ? '?' + qs : '');
      if (replace) {
        window.history.replaceState(null, '', newUrl);
      } else {
        window.history.pushState(null, '', newUrl);
      }
      setUrlParams(new URLSearchParams(newParams));
    }
  };

  const page = pathPage[window.location.pathname] || (urlParams.get('page') || 'dashboard');
  const busId = urlParams.get('bus');
  const tab = urlParams.get('tab') || 'Overview';

  return { page, busId, tab, status: urlParams.get('status'), tripStatus: urlParams.get('tripStatus'), alertCategory: urlParams.get('category'), alertStatus: urlParams.get('status'), alertId: urlParams.get('alert'), navigate };
}

/* ─── Main App ───────────────────────────────────────── */

export function AuthorizedDashboard({ user }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const { buses, status: busesStatus } = useLiveBuses();
  const registeredBusIds = useMemo(() => busesStatus !== 'ready' ? null
    : normalizeOperationalBuses(buses).map((bus) => bus.id), [buses, busesStatus]);
  const { gpsByBusId, realtime: gpsRealtime } = useLiveGps(registeredBusIds);
  const backendPoll = useBackendHealth();
  const gpsNowMs = useGpsFreshnessClock();
  const systemHealth = useMemo(() => deriveSystemHealth({
    gpsByBusId,
    backendPoll,
    realtime: gpsRealtime,
    nowMs: gpsNowMs,
  }), [gpsByBusId, backendPoll, gpsRealtime, gpsNowMs]);
  useHealthTransitionDiagnostics(systemHealth);
  const telemetryBuses = useMemo(() => normalizeOperationalBuses(buses), [buses]);
  const busesWithGps = useMemo(
    () => telemetryBuses.map((bus) => ({ ...bus, gps: gpsByBusId[bus.id] || null })),
    [telemetryBuses, gpsByBusId],
  );
  const connectivityStatus = useMemo(
    () => deriveDashboardConnectivityStatus(systemHealth.backend),
    [systemHealth.backend],
  );
  const synchronizedSamples = useMemo(() => buildSynchronizedSampleData(telemetryBuses), [telemetryBuses]);
  const { trips } = synchronizedSamples;
  const [alertChanges, setAlertChanges] = useState({});
  const generatedAlerts = useMemo(() => buildApplicationAlerts(busesWithGps, gpsNowMs), [busesWithGps, gpsNowMs]);
  const monitoringState = useMemo(() => deriveMonitoringState(busesWithGps, generatedAlerts.map((alert) => ({ ...alert, ...alertChanges[alert.id] }))), [busesWithGps, generatedAlerts, alertChanges]);
  const { alerts, activeAlerts } = monitoringState;
  const { popupAlertId, dismiss: dismissPopupAlert } = useAlertNotification(alerts);
  const activeAlertCount = alerts.filter(isUnacknowledgedAlert).length;
  const updateAlert = (id, changes) => setAlertChanges((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  const { page: activePage, busId: selectedBusId, tab: selectedTab, status: mapStatus, tripStatus: mapTripStatus, alertCategory, alertStatus, alertId, navigate } = useUrlState();

  const setActivePage = (page) => {
    if (typeof page === 'object') return navigate({ bus: undefined, tab: undefined, status: undefined, tripStatus: undefined, category: undefined, alert: undefined, alertType: undefined, ...page });
    navigate({ page, bus: page === 'dashboard' ? null : selectedBusId, tab: undefined, status: undefined, tripStatus: undefined, category: undefined, alert: undefined, alertType: undefined });
  };
  const setSelectedBusId = (busId, replace = false) => navigate({ bus: busId }, replace);


  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 5000);
    return () => clearInterval(timer);
  }, []);


  useEffect(() => {
    if (busesStatus !== 'ready') return;
    const validBusId = getValidSelectedBusId(buses, selectedBusId);
    if (validBusId !== selectedBusId) setSelectedBusId(validBusId, true);
  }, [buses, busesStatus, selectedBusId, activePage]);

  const selectedBus = busesWithGps.find((bus) => bus.id === selectedBusId) || null;
  const mapBuses = busesWithGps.filter((bus) => (mapStatus !== 'online' || bus.status === 'active') && (mapTripStatus !== 'active' || trips.some((trip) => trip.busId === bus.id && trip.status === 'Active')));
  const mapSelectedBus = mapBuses.find((bus) => bus.id === selectedBusId) || null;
  const mapSelectedTrip = trips.find((trip) => trip.busId === mapSelectedBus?.id);

  const pageHeaders = {
    dashboard: { title: 'Monitoring Overview', subtitle: 'Live fleet, route, vehicle condition, and system status' },
    map: { title: 'Live Map Monitoring', subtitle: 'Real-time GPS tracking and route compliance' },
    'live-camera': { title: 'Live Camera View', subtitle: 'Pi1 and Pi2 dashboard camera monitoring' },
    'vehicle-condition': { title: 'Vehicle Condition Monitoring', subtitle: 'Gauge panel sensor data across the fleet' },
    alerts: { title: 'Alert Center', subtitle: 'Manage vehicle condition, route, and connectivity alerts' },
    records: { title: 'Activity Records', subtitle: 'Event logs and synchronization status' },
    settings: { title: 'Settings', subtitle: 'Device setup, administrator preferences and notifications' },
  };

  let pageContent;
  switch (activePage) {
    case 'map': pageContent = <LeafletMapPanel selectedBus={mapSelectedBus} selectedTrip={mapSelectedTrip} onSelect={(b) => setSelectedBusId(b.id)} monitoredBuses={mapBuses} routeSafeRadiusM={ROUTE_DEVIATION_DEFAULT_M} onCenterBus={() => {}} resizeSignal={`${selectedBusId}-${mapStatus}-${mapTripStatus}`} autoCenterKey={`${mapStatus}-${mapTripStatus}`} showDetails nowMs={gpsNowMs} />; break;
    case 'live-camera': pageContent = <LiveCameraView authorized={Boolean(user?.id)} buses={busesWithGps} frameService={CAMERA_FRAME_SERVICE} historyService={CONDITION_HISTORY_SERVICE} />; break;
    case 'vehicle-condition': pageContent = <VehicleConditionPage buses={telemetryBuses} fleetStatus={busesStatus} selectedBus={selectedBus} selectedBusId={selectedBusId} onSelectBus={(b) => setSelectedBusId(b.id)} onNavigate={setActivePage} nowMs={gpsNowMs} />; break;
    case 'alerts': pageContent = <AlertsPage alerts={alerts} buses={telemetryBuses} onUpdateAlert={updateAlert} initialCategory={alertCategory} initialStatus={alertStatus} selectedAlertId={alertId} />; break;
    case 'records': pageContent = <LoadablePanel load={loadGpsHistoryExplorer} loadingLabel="Loading activity records…" buses={telemetryBuses} initialBusId={selectedTab === 'condition-history' ? selectedBusId || '' : ''} />; break;
    case 'settings': pageContent = null; break;
    default: pageContent = (
      <>
        <SummaryCards counts={monitoringState} busesLoading={busesStatus !== 'ready'} onNavigate={setActivePage} />
        <MonitoringOverviewFleet buses={busesWithGps} trips={trips} selectedBusId={selectedBusId} onSelectBusId={setSelectedBusId} onNavigate={setActivePage} nowMs={gpsNowMs} systemHealth={systemHealth} />
        <ActiveAlertsPanel buses={telemetryBuses} activeAlerts={activeAlerts} onAcknowledge={(alert) => updateAlert(alert.id, { workflowStatus: 'Acknowledged', acknowledgedBy: user.email || 'Administrator', acknowledgedAt: Date.now() })} onNavigate={setActivePage} />
      </>
    );
  }

  return (
      <main className="min-h-screen bg-[#F5F6F8] text-[#1F2937]">
      <Sidebar 
        activePage={activePage} 
        onNavigate={setActivePage} 
        open={sidebarOpen} 
        onToggle={(next) => setSidebarOpen(typeof next === 'boolean' ? next : !sidebarOpen)} 
        alertCount={activeAlertCount}
        onLogout={signOutActiveUser}
      />
      <div className={`main-content dashboard-page dashboard-content flex flex-col gap-5 pb-10 ${activePage === 'dashboard' ? 'overview-wide-shell' : ''} ${activePage === 'live-camera' ? 'camera-monitor-shell' : ''} ${activePage === 'vehicle-condition' ? 'condition-monitor-shell' : ''} ${sidebarOpen ? 'sidebar-expanded' : ''}`}>
        <Header currentTime={currentTime} activePageTitle={pageHeaders[activePage]?.title} activePageSubtitle={pageHeaders[activePage]?.subtitle} alertCount={activeAlertCount} systemHealth={systemHealth} connectivityStatus={connectivityStatus} alerts={alerts} buses={telemetryBuses} onToggleSidebar={() => setSidebarOpen((current) => !current)} onViewAlert={(alert) => navigate({ page: 'alerts', bus: alert.busNumber, alert: alert.id, alertType: getAlertCategory(alert) === 'Route' ? 'route-deviation' : undefined })} user={user} />
        {activePage === 'settings' ? <SettingsPage user={user} onLogout={signOutActiveUser} buses={buses} busesStatus={busesStatus}
          gpsByBusId={gpsByBusId} gpsRealtime={gpsRealtime} backendPoll={backendPoll} gpsNowMs={gpsNowMs} /> : pageContent}
      </div>
      {popupAlertId && alerts.find((alert) => alert.id === popupAlertId && isUnacknowledgedAlert(alert)) && <AlertNotification alert={alerts.find((alert) => alert.id === popupAlertId)} buses={telemetryBuses} onDismiss={dismissPopupAlert} onViewMap={() => { dismissPopupAlert(); const alert = alerts.find((item) => item.id === popupAlertId); navigate({ page: 'map', bus: alert?.busNumber, alert: getAlertCategory(alert || {}) === 'Route' ? 'route-deviation' : undefined }); }} onReview={() => { dismissPopupAlert(); const alert = alerts.find((item) => item.id === popupAlertId); navigate({ page: 'alerts', bus: alert?.busNumber, alert: alert?.id, alertType: getAlertCategory(alert || {}) === 'Route' ? 'route-deviation' : undefined }); }} onAcknowledge={() => { const alert = alerts.find((item) => item.id === popupAlertId); if (alert) updateAlert(alert.id, { workflowStatus: 'Acknowledged', acknowledgedBy: 'Admin', acknowledgedAt: Date.now() }); dismissPopupAlert(); }} />}
      </main>
  );
}

export { default } from './DashboardApp';
