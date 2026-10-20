import { fireEvent, render as renderPage, screen, waitFor, within, act } from '@testing-library/react';
import {cloneElement} from 'react';
import SynchronizedCameraView from './SynchronizedCameraView';
import { FRAME_GAUGE_KEYS } from './cameraFrameService';
import { captureSynchronizedFrame, downloadCameraEvidence } from './cameraEvidence';
jest.mock('./cameraEvidence',()=>({captureSynchronizedFrame:jest.fn(),downloadCameraEvidence:jest.fn()}));
const NOW = Date.parse('2026-10-20T04:00:00.000Z'); const clock = () => NOW;
// Most regressions exercise the enabled view. Default-off behavior has its own
// test below; enabling is always an explicit user switch, not a product default.
const render=element=>{const ui=renderPage(cloneElement(element,{decode:element.props.decode||asyncDecode}));fireEvent.click(screen.getByRole('switch'));return ui;};
const asyncDecode=async()=>{};
function reply(device = 'GPS-001', sequence = 1) {
  return { state: 'live', frame: { device_id: device, camera_id: `cam-${device}`, bus_id: `bus-${device}`,
    capture_id: `session:${sequence}`, captured_at: new Date(NOW-1000).toISOString(), image: { base64: 'AAAA' },
    readings: FRAME_GAUGE_KEYS.map((gauge_key) => ({ gauge_key, quality: 'detected', value: 35, unit: gauge_key.includes('Air') ? 'kg/cm2' : '%', angle_deg: 90, dial_percent: 35 })) } };
}

test('preview choice survives switching browser tabs and returns without another click',async()=>{
  const original=Object.getOwnPropertyDescriptor(document,'hidden');let hidden=false;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  const live=reply();live.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
  const service={fastPreview:true,read:async()=>({state:'waiting',frame:null}),readLive:jest.fn(async()=>live)};
  const ui=render(<SynchronizedCameraView service={service} clock={clock} decode={async()=>{}}/>);
  try{
    await screen.findByRole('img');
    await screen.findByText('Camera preview live');
    act(()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    act(()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    await screen.findByRole('img');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','true');
    expect(downloadCameraEvidence).not.toHaveBeenCalled();
  }finally{
    ui.unmount();
    if(original)Object.defineProperty(document,'hidden',original);else delete document.hidden;
  }
});
test('six actual observations render without invented physical condition or confidence', async () => {
  const service = { read: jest.fn(async () => reply()) };
  render(<SynchronizedCameraView service={service} clock={clock} />);
  await waitFor(() => expect(screen.getAllByText('35')).toHaveLength(6));
  expect(screen.getAllByText(/Interpretation unverified/)).toHaveLength(1);
  expect(screen.queryByText(/^Normal$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
  expect(service.read).toHaveBeenCalledWith('GPS-001', expect.objectContaining({ preview: true }));
  expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled();
});

test('partial same-capture observations show valid numbers and leave rejected gauges uncertain',async()=>{
  const raw=reply();raw.frame.readings.forEach(r=>{
    if(['frontAir','rearAir'].includes(r.gauge_key))Object.assign(r,{quality:'uncertain',value:null,angle_deg:null,dial_percent:null});
  });
  render(<SynchronizedCameraView service={{read:async()=>raw}} clock={clock}/>);
  await waitFor(()=>expect(screen.getAllByText('35')).toHaveLength(4));
  const condition=screen.getByRole('region',{name:'Pi1 vehicle condition'});
  const uncertain=condition.querySelectorAll('[data-gauge-key="frontAir"], [data-gauge-key="rearAir"]');
  expect(uncertain).toHaveLength(2);
  for(const node of uncertain){
    expect(within(node).getByText(/^Uncertain · no value$/)).toBeInTheDocument();
    expect(within(node).queryByText('35')).not.toBeInTheDocument();
  }
});
test('new values do not replace the visible old capture before its matching image decodes', async () => {
  let decode;
  const pending = new Promise((resolve) => { decode = resolve; });
  const service = { read: jest.fn(async () => reply()) };
  let first=true;
  render(<SynchronizedCameraView service={service} clock={clock} decode={()=>{if(first){first=false;return Promise.resolve();}return pending;}} />);
  await waitFor(() => expect(screen.getAllByText('35')).toHaveLength(6));
  const next = reply('GPS-001', 2); next.frame.readings.forEach((r) => { r.value = 62; });
  service.read.mockResolvedValue(next);
  await waitFor(() => expect(service.read).toHaveBeenCalledTimes(2),{timeout:2500});
  expect(screen.queryByText('62')).not.toBeInTheDocument();
  await act(async () => { decode(); });
  await waitFor(() => expect(screen.getAllByText('62')).toHaveLength(6));
  expect(screen.getByRole('img')).toHaveAttribute('data-capture-id', 'session:2');
  expect(screen.getByRole('region', { name: 'Pi1 vehicle condition' })).toHaveAttribute('data-capture-id', 'session:2');
});
test('Pi switch cancels old work and never pairs Pi1 image with Pi2 readings', async () => {
  let late;
  const service = { read: jest.fn((device) => device === 'GPS-001' ? new Promise((resolve) => { late = resolve; }) : Promise.resolve(reply(device))) };
  render(<SynchronizedCameraView service={service} clock={clock} />);
  await waitFor(() => expect(service.read).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('tab', { name: /Pi2/ }));
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getAllByText('35')).toHaveLength(6));
  await act(async () => { late(reply()); });
  expect(screen.queryByRole('region', { name: 'Pi1 vehicle condition' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Pi2 vehicle condition' })).getByText(/GPS-002/)).toBeInTheDocument();
});
test('last-known values are visibly stale, cannot capture, and missing gauges remain unavailable', async () => {
  const next = reply(); next.state = 'last-known'; delete next.frame.image.base64;
  next.frame.readings[0] = { ...next.frame.readings[0], quality: 'undetected', value: null, angle_deg: null, dial_percent: null };
  render(<SynchronizedCameraView service={{ read: async () => next }} clock={clock} />);
  await screen.findByText('Analysis stale · Values withheld');
  expect(screen.queryByText('35')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('switching devices while PNG is being prepared cancels the old camera download',async()=>{
  let complete;
  captureSynchronizedFrame.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  render(<SynchronizedCameraView service={{read:async(device)=>reply(device)}} clock={clock} decode={async()=>{}}/>);
  await waitFor(()=>expect(screen.getAllByText('35')).toHaveLength(6));
  await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button',{name:'Capture'}));
  expect(captureSynchronizedFrame).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab',{name:/Pi2/}));
  await act(async()=>{complete({blob:new Blob(['synthetic']),filename:'synthetic.png'});});
  expect(downloadCameraEvidence).not.toHaveBeenCalled();
});

test('real preview remains viewable with six undetected null gauges and no false Detected label',async()=>{
  const raw=reply();raw.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
  render(<SynchronizedCameraView service={{read:async()=>raw}} clock={clock} decode={async()=>{}}/>);
  await screen.findByText('Camera active · Gauges not detected');
  expect(screen.getAllByText('Not detected')).toHaveLength(6);
  expect(screen.queryByText('35')).not.toBeInTheDocument();
  expect(screen.queryByText('Detected values · not calibrated')).not.toBeInTheDocument();
  const image=await screen.findByRole('img');
  expect(image).toHaveAttribute('data-capture-id',raw.frame.capture_id);
  expect(screen.getByRole('button',{name:'Capture'})).toBeEnabled();
  expect(screen.queryByTestId('fuel-needle')).not.toBeInTheDocument();
});

test('a matching detection can enrich the same preview, but a new unreadable scene clears those values',async()=>{
  jest.useFakeTimers();
  try {
    let next=reply();next.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
    render(<SynchronizedCameraView service={{read:async()=>next}} clock={clock} decode={async()=>{}}/>);
    await act(async()=>{});
    expect(screen.getByRole('img')).toHaveAttribute('data-capture-id','session:1');
    next=reply();await act(async()=>{jest.advanceTimersByTime(1000);});
    expect(screen.getAllByText('35')).toHaveLength(6);
    expect(screen.getByRole('img')).toHaveAttribute('data-capture-id','session:1');
    next=reply('GPS-001',2);next.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
    await act(async()=>{jest.advanceTimersByTime(1000);});
    expect(screen.getByRole('img')).toHaveAttribute('data-capture-id','session:2');
    expect(screen.queryByText('35')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not detected')).toHaveLength(6);
  } finally {jest.useRealTimers();}
});

function loadFrozenCapture() {
  const node=document.querySelector('div[aria-hidden="true"] img');
  Object.defineProperties(node,{complete:{value:true,configurable:true},naturalWidth:{value:640,configurable:true},naturalHeight:{value:360,configurable:true}});
  fireEvent.load(node);
}
test('fast preview never downloads automatically; Capture uses the matching analyzed frame, not newer live pixels',async()=>{
  jest.clearAllMocks();captureSynchronizedFrame.mockResolvedValue({blob:new Blob(['fixture']),filename:'matched.png'});
  const newer=reply('GPS-001',99);newer.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
  const service={fastPreview:true,read:async()=>reply(),readLive:async()=>newer};
  render(<SynchronizedCameraView service={service} clock={clock} decode={async()=>{}}/>);
  await waitFor(()=>expect(screen.getAllByText('35')).toHaveLength(6));
  await screen.findByAltText(/live preview session:99/);
  expect(downloadCameraEvidence).not.toHaveBeenCalled();expect(captureSynchronizedFrame).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Capture'}));loadFrozenCapture();
  await waitFor(()=>expect(downloadCameraEvidence).toHaveBeenCalledTimes(1));
  expect(captureSynchronizedFrame.mock.calls[0][0].frame.capture_id).toBe('session:1');
  expect(captureSynchronizedFrame.mock.calls[0][0].frame.readings.every(r=>r.value===35)).toBe(true);
});
test('before any detection, a Capture click saves live pixels with null gauges only, never fabricated readings',async()=>{
  jest.clearAllMocks();captureSynchronizedFrame.mockResolvedValue({blob:new Blob(['fixture']),filename:'null-gauges.png'});
  const raw=reply();raw.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
  const service={fastPreview:true,read:async()=>({state:'waiting',frame:null}),readLive:async()=>raw};
  render(<SynchronizedCameraView service={service} clock={clock} decode={async()=>{}}/>);
  await screen.findByAltText(/live preview session:1/);
  expect(downloadCameraEvidence).not.toHaveBeenCalled();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Capture'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Capture'}));loadFrozenCapture();
  await waitFor(()=>expect(downloadCameraEvidence).toHaveBeenCalledTimes(1));
  expect(captureSynchronizedFrame.mock.calls[0][0].frame.readings.every(r=>r.value===null)).toBe(true);
});

test('stale numbers stay hidden in the view and capture; preview off pauses browser analysis reads',async()=>{
  jest.clearAllMocks();captureSynchronizedFrame.mockResolvedValue({blob:new Blob(['fixture']),filename:'raw.png'});
  const old=reply();old.state='last-known';old.frame.captured_at=new Date(NOW-60000).toISOString();delete old.frame.image.base64;
  const raw=reply('GPS-001',99);raw.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
  const read=jest.fn(async()=>old);
  render(<SynchronizedCameraView service={{fastPreview:true,read,readLive:async()=>raw}} clock={clock} decode={async()=>{}}/>);
  await screen.findByText('Analysis stale · Values withheld');
  expect(screen.queryByText('35')).not.toBeInTheDocument();
  await screen.findByAltText(/live preview session:99/);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Capture'})).toBeEnabled());
  expect(screen.getByText(/Capture source · current live image only/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Capture'}));loadFrozenCapture();
  await waitFor(()=>expect(downloadCameraEvidence).toHaveBeenCalledTimes(1));
  const saved=captureSynchronizedFrame.mock.calls[0][0].frame;
  expect(saved.capture_id).toBe('session:99');expect(saved.readings.every(r=>r.value===null)).toBe(true);
  const prior=read.mock.calls.length;
  fireEvent.click(screen.getByRole('switch'));
  expect(read.mock.calls.length).toBe(prior);
  expect(screen.getByText('Preview off · Readings hidden')).toBeInTheDocument();
  expect(screen.getByText('Freshness: Off')).toBeInTheDocument();
});

test('local folder save runs once after Capture, with a confirmed receipt instead of an automatic download',async()=>{
  jest.clearAllMocks();captureSynchronizedFrame.mockResolvedValue({blob:new Blob(['png'],{type:'image/png'}),filename:'capture.png'});
  const raw=reply();raw.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
  const saveCapture=jest.fn(async()=>({saved:true,relativePath:'captured-images/capture.png'}));
  const service={fastPreview:true,read:async()=>({state:'waiting',frame:null}),readLive:async()=>raw,saveCapture};
  render(<SynchronizedCameraView service={service} clock={clock} decode={async()=>{}}/>);
  await screen.findByAltText(/live preview session:1/);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Capture'})).toBeEnabled());
  expect(saveCapture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Capture'}));loadFrozenCapture();
  await screen.findByText('Saved: captured-images/capture.png');
  expect(saveCapture).toHaveBeenCalledTimes(1);expect(downloadCameraEvidence).not.toHaveBeenCalled();
});

test('preview defaults off, reads nothing, clears numbers immediately on off and ignores late responses',async()=>{
  let late;
  const read=jest.fn(async()=>reply());
  renderPage(<SynchronizedCameraView service={{read}} clock={clock} decode={async()=>{}}/>);
  expect(read).not.toHaveBeenCalled();expect(screen.queryByText('35')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch'));await waitFor(()=>expect(screen.getAllByText('35')).toHaveLength(6));
  expect(screen.getByText(/Fresh · 1s since capture/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.queryByText('35')).not.toBeInTheDocument();
  expect(screen.queryByTestId('fuel-needle')).not.toBeInTheDocument();
  read.mockImplementation(()=>new Promise(resolve=>{late=resolve;}));
  fireEvent.click(screen.getByRole('switch'));await waitFor(()=>expect(late).toBeDefined());
  fireEvent.click(screen.getByRole('switch'));await act(async()=>late(reply()));
  expect(screen.queryByText('35')).not.toBeInTheDocument();expect(screen.getByText('Freshness: Off')).toBeInTheDocument();
});

test('freshness uses the original capture time and expires numbers even if the server keeps returning live',async()=>{
  jest.useFakeTimers();let time=NOW;
  const ui=render(<SynchronizedCameraView service={{read:async()=>reply()}} clock={()=>time} decode={async()=>{}}/>);
  try{
    await act(async()=>{});expect(screen.getAllByText('35')).toHaveLength(6);
    time=NOW+16000;await act(async()=>{jest.advanceTimersByTime(1000);});
    expect(screen.queryByText('35')).not.toBeInTheDocument();
    expect(screen.getByText(/Stale · 17s since capture/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Capture'})).toBeDisabled();
  }finally{ui.unmount();jest.useRealTimers();}
});
