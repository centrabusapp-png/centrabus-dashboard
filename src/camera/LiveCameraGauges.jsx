import { Activity, Battery, Droplets, Fuel, Gauge, Thermometer } from 'lucide-react';
import CameraGaugePanel from './CameraGaugePanel';
import { approvedDialPosition, cameraDialStatus, LIVE_GAUGE_PLACEHOLDERS, LIVE_GAUGE_TITLES } from './liveCameraGaugeModel';
import { BUS_DIAL, BUS_DIAL_PATH, detectedNeedleAngle, dialPoint, dialScaleAngle } from './cameraDialGeometry';

const icons = { fuel: Fuel, oilPressure: Droplets, coolant: Thermometer, frontAir: Gauge, battery: Battery, rearAir: Gauge };

export function AnimatedCameraGauge({ gauge, calibration, compact = false }) {
  const Icon = icons[gauge.gaugeKey] || Gauge;
  const available = Number.isFinite(gauge.numericValue);
  const stale = gauge.status === 'Stale';
  const relative = gauge.unverified === true && Number.isFinite(gauge.dialPositionPercent)
    && gauge.dialPositionPercent >= 0 && gauge.dialPositionPercent <= 100;
  const ends = gauge.gaugeKey==='fuel'?['E','F']:gauge.gaugeKey==='coolant'?['C','H']:['L','H'];
  const dial = relative ? { percent: gauge.dialPositionPercent, min: ends[0], max: ends[1] } : approvedDialPosition(gauge, calibration);
  const title = LIVE_GAUGE_TITLES[gauge.gaugeKey] || gauge.label;
  const value = available ? gauge.numericValue.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';
  const dialStatus = cameraDialStatus(gauge);
  const angle = detectedNeedleAngle(gauge);
  const pressure = ['frontAir', 'rearAir'].includes(gauge.gaugeKey);
  const ticks = pressure ? 15 : 4;
  // Camera angles use atan2(up, right): 90 degrees is straight up. Use the
  // actual detected direction when present; approved older sources without an
  // angle retain a display-only position on the shorter bus-style scale.
  const rotation = angle !== null ? 90 - angle : dial ? 90 - dialScaleAngle(dial.percent) : null;
  return <article className={`camera-condition-gauge ${compact ? 'is-compact' : ''} ${stale ? 'is-stale' : ''}`}
    data-gauge-key={gauge.gaugeKey} data-camera-id={gauge.cameraId || undefined}
    aria-label={`${title}: ${available ? `${value} ${gauge.unit}` : 'Awaiting data'}${stale ? ', last-known reading' : ''}`}>
    <div className="camera-gauge-heading"><span className="camera-gauge-icon"><Icon size={16} aria-hidden="true" /></span><h3>{title}</h3></div>
    <svg viewBox="0 0 200 128" className="camera-condition-dial" aria-hidden="true" data-sweep-degrees={BUS_DIAL.start - BUS_DIAL.end}>
      <path d={BUS_DIAL_PATH} fill="none" stroke="#cbd5e1" strokeWidth="4" />
      {Array.from({ length: ticks + 1 }, (_, index) => {
        const markAngle = dialScaleAngle(index / ticks * 100);
        const major = pressure ? index % 5 === 0 : index % 2 === 0;
        const inside = dialPoint(markAngle, major ? 74 : 80), outside = dialPoint(markAngle, 88);
        const label = dialPoint(markAngle, 59);
        return <g key={index}><line x1={inside.x} y1={inside.y} x2={outside.x} y2={outside.y}
          stroke="#b9c3d0" strokeWidth={major ? 3 : 1.5} />
          {pressure && major && <text x={label.x} y={label.y + 3} textAnchor="middle" className="camera-dial-scale">{index}</text>}</g>;
      })}
      {rotation !== null ? <g data-testid={`${gauge.gaugeKey}-needle`} className={`camera-gauge-needle ${stale ? 'is-stale' : ''}`}
        style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '100px 108px' }}>
        <path d="M 97 108 L 100 29 L 103 108 Z" fill={stale ? '#94a3b8' : '#8e1f2f'} />
      </g> : <text x="100" y="92" textAnchor="middle" className="camera-dial-pending">{available ? 'SCALE PENDING' : 'NO READING'}</text>}
      <circle cx="100" cy="108" r="8" fill={rotation !== null && !stale ? '#8e1f2f' : '#cbd5e1'} /><circle cx="100" cy="108" r="3" fill="white" />
      {!pressure && <><text x="28" y="80" textAnchor="middle" className="camera-dial-scale">{relative || gauge.unverified ? ends[0] : dial?.min ?? ends[0]}</text>
        <text x="172" y="80" textAnchor="middle" className="camera-dial-scale">{relative || gauge.unverified ? ends[1] : dial?.max ?? ends[1]}</text></>}
    </svg>
    <div className="camera-gauge-value">{value}<span>{available ? gauge.unit : 'Awaiting data'}</span></div>
    <p className="camera-gauge-angle" title="Original detected needle angle from this camera capture; not calculated from the displayed percentage.">
      Angle: {angle !== null ? `${angle.toFixed(2)}°` : '—'}</p>
    <div className={`camera-gauge-quality ${available && !stale ? 'has-reading' : ''}`}>
      <span className="camera-quality-dot" />{stale ? 'Last known · stale' : gauge.unverified ? gauge.quality === 'detected' ? compact ? 'Detected · estimate' : 'Detected · camera estimate' : gauge.quality === 'uncertain' ? 'Uncertain · no value' : 'Not detected' : available ? 'Validated reading' : 'Not yet verified'}
    </div>
    <p className="camera-gauge-capture">{gauge.capturedAt
      ? <><time dateTime={gauge.capturedAt} title={gauge.capturedAt}>{new Date(gauge.capturedAt).toLocaleTimeString()}</time> · {Math.floor(gauge.ageMs / 1000)}s ago</>
      : gauge.gaugeKey === 'oilPressure' ? 'Gauge meaning / units pending' : 'No validated capture'}</p>
    {available && Number.isFinite(gauge.confidence) && <p className="camera-gauge-confidence">Confidence {Math.round(gauge.confidence * 100)}%</p>}
    {gauge.unverified && (!compact || dialStatus) && <p className="camera-gauge-confidence"
      title={Number.isFinite(gauge.angleDegrees)?`Detected needle angle: ${gauge.angleDegrees.toFixed(3)}°. Dial position is not a validated physical measurement.`:undefined}>
      {dialStatus ? compact ? dialStatus : `${dialStatus} · dial estimate` : gauge.quality === 'uncertain' ? 'Uncertain · check camera view' : 'Waiting for detection'}</p>}
  </article>;
}

export default function LiveCameraGauges({ device, association, enabled, service, calibration, expectedCameraId, clock, panelRef }) {
  const approvedSource = Boolean(enabled && association.busId);
  const policy = approvedSource ? calibration : null;
  return <section ref={panelRef} data-device-id={device.deviceId} aria-label={`${device.shortName} vehicle condition`} className="camera-condition-panel">
    <header className="camera-condition-heading"><span className="camera-condition-icon"><Activity size={22} aria-hidden="true" /></span>
      <div><p className="camera-section-eyebrow">Camera-derived readings</p><h2>Vehicle condition monitoring</h2>
        <p className="camera-section-detail">{device.deviceId} · {association.plate || 'Bus association unverified'}</p></div>
      <span className="camera-six-gauges">6 gauges</span>
    </header>
    <div className="camera-condition-body">
      <CameraGaugePanel enabled busId={association.busId} service={service} calibration={policy} clock={clock}
        expectedCameraId={expectedCameraId} refreshIntervalMs={10000} placeholderGauges={LIVE_GAUGE_PLACEHOLDERS}
        gridClassName="camera-condition-grid"
        renderStatus={(state) => <div role="status" className="camera-condition-source"><span className="camera-source-dot" />
          <div><strong>{!enabled ? 'Readings not connected' : association.message ? 'Association not verified' : state.status}</strong>
            <p>{association.message || (!enabled ? 'Waiting for the approved camera-processing connection.' : state.message)}</p></div></div>}
        renderGauge={(gauge) => <AnimatedCameraGauge gauge={gauge} calibration={policy} />} />
      <p className="camera-condition-note">Needles use approved display scales only. Missing readings are never zero; air-pressure gauges are not tire-pressure sensors.</p>
    </div>
  </section>;
}
