import { act, render, screen, waitFor } from '@testing-library/react';
import FastLivePreview from './FastLivePreview';
const NOW=Date.parse('2026-10-20T04:00:00.000Z');const clock=()=>NOW;
const device={deviceId:'GPS-001',shortName:'Pi1'};
const raw=()=>({state:'live',frame:{device_id:'GPS-001',camera_id:'cam-GPS-001',bus_id:'bus-GPS-001',capture_id:'test-session:1',
  captured_at:new Date(NOW-1000).toISOString(),image:{base64:'AAAA'},readings:[]}});
test('RAM preview is opt-in; latest image ref is released when off or unmounted',async()=>{
  const service={readLive:jest.fn(async()=>raw())},latest={current:null},available=jest.fn(),decode=jest.fn(async()=>{});
  const props={device,service,clock,decode,latestFrameRef:latest,onAvailability:available};
  const ui=render(<FastLivePreview {...props} enabled={false}/>);
  expect(service.readLive).not.toHaveBeenCalled();expect(latest.current).toBeNull();
  ui.rerender(<FastLivePreview {...props} enabled/>);await screen.findByRole('img');expect(latest.current.capture_id).toBe('test-session:1');
  expect(screen.getByText(/not recorded/)).toBeInTheDocument();
  ui.rerender(<FastLivePreview {...props} enabled={false}/>);expect(latest.current).toBeNull();expect(screen.queryByRole('img')).not.toBeInTheDocument();
  ui.unmount();expect(latest.current).toBeNull();
});
test('requests never overlap and a stopped preview cannot adopt a late reply',async()=>{
  jest.useFakeTimers();
  try{
    let complete;const service={readLive:jest.fn(()=>new Promise(r=>{complete=r;}))},latest={current:null};
    const props={device,service,clock,decode:async()=>{},latestFrameRef:latest,onAvailability:()=>{}};
    const ui=render(<FastLivePreview {...props} enabled/>);
    await act(async()=>{jest.advanceTimersByTime(1000);});expect(service.readLive).toHaveBeenCalledTimes(1);
    ui.rerender(<FastLivePreview {...props} enabled={false}/>);
    await act(async()=>{complete(raw());});expect(latest.current).toBeNull();expect(screen.queryByRole('img')).not.toBeInTheDocument();
  }finally{jest.useRealTimers();}
});
test('stale live frame never remains a fresh picture and authority errors clear it',async()=>{
  let now=NOW;const ticking=()=>now;const service={readLive:jest.fn(async()=>raw())},latest={current:null};
  render(<FastLivePreview device={device} service={service} enabled clock={ticking} decode={async()=>{}} latestFrameRef={latest} onAvailability={()=>{}}/>);
  await screen.findByRole('img');now=NOW+3000;
  await waitFor(()=>expect(screen.queryByRole('img')).not.toBeInTheDocument());
  service.readLive.mockRejectedValue(Error('auth denied'));
  await waitFor(()=>expect(latest.current).toBeNull());
});

test('hiding pauses and releases the preview; returning resumes with a new request',async()=>{
  const original=Object.getOwnPropertyDescriptor(document,'hidden');
  let hidden=false;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  const latest={current:null},service={readLive:jest.fn(async()=>raw())};
  const ui=render(<FastLivePreview device={device} service={service} enabled clock={clock}
    decode={async()=>{}} latestFrameRef={latest} onAvailability={()=>{}}/>);
  try {
    await screen.findByRole('img');
    act(()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    expect(screen.queryByRole('img')).not.toBeInTheDocument();expect(latest.current).toBeNull();
    const calls=service.readLive.mock.calls.length;
    act(()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    await screen.findByRole('img');
    expect(service.readLive.mock.calls.length).toBeGreaterThan(calls);
  } finally {
    ui.unmount();
    if(original)Object.defineProperty(document,'hidden',original);else delete document.hidden;
  }
});

test('brief delivery failures do not blank a still-fresh frame; auth rejection immediately clears it',async()=>{
  const service={readLive:jest.fn(async()=>raw())},latest={current:null};
  render(<FastLivePreview device={device} service={service} enabled clock={clock} decode={async()=>{}}
    latestFrameRef={latest} onAvailability={()=>{}}/>);
  await screen.findByRole('img');
  service.readLive.mockRejectedValue(Error('camera-temporary-unavailable'));
  const count=service.readLive.mock.calls.length;
  await waitFor(()=>expect(service.readLive.mock.calls.length).toBeGreaterThan(count));
  expect(screen.getByRole('img')).toBeInTheDocument();expect(latest.current).not.toBeNull();
  service.readLive.mockRejectedValue(Error('camera-not-ready'));
  await waitFor(()=>expect(latest.current).toBeNull());expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('distinguishes waiting for a Pi publisher, missing enrollment, and a transport reconnect',async()=>{
  const latest={current:null};
  const service={readLive:jest.fn(async()=>({state:'waiting',frame:null}))};
  const props={device,service,enabled:true,clock,decode:async()=>{},latestFrameRef:latest,onAvailability:()=>{}};
  const ui=render(<FastLivePreview {...props}/>);
  expect(await screen.findByText('Waiting for Pi1 camera publisher')).toBeInTheDocument();
  expect(screen.getByText('Waiting for a fresh RAM-only camera frame')).toBeInTheDocument();
  service.readLive.mockResolvedValue({state:'not-enrolled',frame:null});
  await waitFor(()=>expect(screen.getByText('Camera not enrolled')).toBeInTheDocument());
  expect(screen.getByText('Camera enrollment is required before Pi frames can be accepted')).toBeInTheDocument();
  service.readLive.mockRejectedValue(Error('camera-temporary-unavailable'));
  await waitFor(()=>expect(screen.getByText('Reconnecting to camera preview')).toBeInTheDocument());
  expect(screen.getByText('Connection interrupted · retrying for a fresh frame')).toBeInTheDocument();
  ui.unmount();
});
