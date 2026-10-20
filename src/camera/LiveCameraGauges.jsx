import { Activity, Battery, Droplets, Fuel, Gauge, Thermometer } from 'lucide-react';
import CameraGaugePanel from './CameraGaugePanel';
import { approvedDialPosition, cameraDialStatus, LIVE_GAUGE_PLACEHOLDERS, LIVE_GAUGE_TITLES } from './liveCameraGaugeModel';

const icons = { fuel: Fuel, oilPressure: Droplets, coolant: Thermometer, frontAir: Gauge, battery: Battery, rearAir: Gauge };

export function AnimatedCameraGauge({ gauge, calibration }) {
  const Icon = icons[gauge.gaugeKey] || Gauge;
  const available = Number.isFinite(gauge.numericValue);
  const stale = gauge.status === 'Stale';
  const relative = gauge.unverified === true && Number.isFinite(gauge.dialPositionPercent)
    && gauge.dialPositionPercent >= 0 && gauge.dialPositionPercent <= 100;
  const dial = relative ? { percent: gauge.dialPositionPercent, min: 'L', max: 'H' } : approvedDialPosition(gauge, calibration);
  const title = LIVE_GAUGE_TITLES[gauge.gaugeKey] || gauge.label;
  const value = available ? gauge.numericValue.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';
  const dialStatus = cameraDialStatus(gauge);
  return <article className={`camera-condition-gauge ${stale ? 'is-stale' : ''}`}
    data-gauge-key={gauge.gaugeKey} data-camera-id={gauge.cameraId || undefined}
    aria-label={`${title}: ${available ? `${value} ${gauge.unit}` : 'Awaiting data'}${stale ? ', last-known reading' : ''}`}>
    <div className="camera-gauge-heading"><span className="camera-gauge-icon"><Icon size={16} aria-hidden="true" /></span><h3>{title}</h3></div>
    <svg viewBox="0 0 200 116" className="camera-condition-dial" aria-hidden="true">
      <path d="M 24 94 A 76 76 0 0 1 176 94" fill="none" stroke="#e8ecf2" strokeWidth="10" strokeLinecap="round" />
      {dial && <path d="M 24 94 A 76 76 0 0 1 176 94" fill="none" stroke={stale ? '#94a3b8' : '#8e1f2f'}
        strokeWidth="10" strokeLinecap="round" pathLength="100" strokeDasharray={`${dial.percent} 100`} />}
      {Array.from({ length: 9 }, (_, index) => {
        const angle = Math.PI - index / 8 * Math.PI;
        return <line key={index} x1={100 + Math.cos(angle) * 61} y1={94 - Math.sin(angle) * 61}
          x2={100 + Math.cos(angle) * 67} y2={94 - Math.sin(angle) * 67} stroke="#b9c3d0" strokeWidth={index % 4 ? 1.5 : 2.5} />;
      })}
      {dial ? <g data-testid={`${gauge.gaugeKey}-needle`} className={`camera-gauge-needle ${stale ? 'is-stale' : ''}`}
        style={{ transform: `rotate(${-90 + dial.percent * 1.8}deg)`, transformOrigin: '100px 94px' }}>
        <path d="M 97 94 L 100 35 L 103 94 Z" fill={stale ? '#94a3b8' : '#8e1f2f'} />
      </g> : <text x="100" y="67" textAnchor="middle" className="camera-dial-pending">{available ? 'SCALE PENDING' : 'NO READING'}</text>}
      <circle cx="100" cy="94" r="7" fill={dial && !stale ? '#8e1f2f' : '#cbd5e1'} /><circle cx="100" cy="94" r="3" fill="white" />
      {dial && <><text x="24" y="112" textAnchor="middle" className="camera-dial-scale">{dial.min}</text>
        <text x="176" y="112" textAnchor="middle" className="camera-dial-scale">{dial.max}</text></>}
    </svg>
    <div className="camera-gauge-value">{value}<span>{available ? gauge.unit : 'Awaiting data'}</span></div>
    <div className={`camera-gauge-quality ${available && !stale ? 'has-reading' : ''}`}>
      <span className="camera-quality-dot" />{stale ? 'Last known · stale' : gauge.unverified ? gauge.quality === 'detected' ? 'Detected · calibration unverified' : gauge.quality === 'uncertain' ? 'Uncertain · no value' : 'Not detected' : available ? 'Validated reading' : 'Not yet verified'}
    </div>
    <p className="camera-gauge-capture">{gauge.capturedAt
      ? <><time dateTime={gauge.capturedAt} title={gauge.capturedAt}>{new Date(gauge.capturedAt).toLocaleTimeString()}</time> · {Math.floor(gauge.ageMs / 1000)}s ago</>
      : gauge.gaugeKey === 'oilPressure' ? 'Gauge meaning / units pending' : 'No validated capture'}</p>
    {available && Number.isFinite(gauge.confidence) && <p className="camera-gauge-confidence">Confidence {Math.round(gauge.confidence * 100)}%</p>}
    {gauge.unverified && <p className="camera-gauge-confidence">{dialStatus ? `${dialStatus} · dial estimate` : gauge.quality === 'uncertain' ? 'Uncertain · check camera view' : 'Waiting for detection'}</p>}
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
