import {render,fireEvent,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import CaptureFrameSnapshot from './CaptureFrameSnapshot';
import {FRAME_GAUGE_KEYS} from './cameraFrameService';

test.each([[false,false],[true,false],[true,true]])('real frozen PNG completes once: cached StrictMode=%s, detected=%s',async(cached,detected)=>{
  const now=Date.parse('2026-10-20T04:00:00.000Z');
  const frame={device_id:'GPS-002',camera_id:'CAM-002',bus_id:'qa-bus',capture_id:'qa:1',
    captured_at:new Date(now-200).toISOString(),image:{base64:'AAAA'},
    readings:FRAME_GAUGE_KEYS.map(gauge_key=>({gauge_key,quality:detected?'detected':'undetected',value:detected?35:null,angle_deg:detected?90:null,dial_percent:detected?35:null,unit:gauge_key.includes('Air')?'kg/cm2':'%'}))};
  const context={fillRect:jest.fn(),fillText:jest.fn(),drawImage:jest.fn()};
  const onDone=jest.fn();
  if(cached){
    jest.spyOn(HTMLImageElement.prototype,'complete','get').mockReturnValue(true);
    jest.spyOn(HTMLImageElement.prototype,'naturalWidth','get').mockReturnValue(640);
    jest.spyOn(HTMLImageElement.prototype,'naturalHeight','get').mockReturnValue(360);
  }
  jest.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
  jest.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(done=>done(new Blob(['png'],{type:'image/png'})));
  jest.spyOn(window,'Image').mockImplementation(()=>{
    const image={};Object.defineProperty(image,'src',{set(value){
      if(!value)return;
      const xml=new DOMParser().parseFromString(decodeURIComponent(value.split(',')[1]),'image/svg+xml');
      Promise.resolve().then(()=>xml.querySelector('parsererror')?image.onerror?.():image.onload?.());
    }});return image;
  });
  try{
    const component=<CaptureFrameSnapshot frame={frame} deviceId="GPS-002" clock={()=>now} onDone={onDone}/>;
    const ui=render(cached?<StrictMode>{component}</StrictMode>:component);
    const image=ui.container.querySelector('img');
    Object.defineProperties(image,{complete:{value:true,configurable:true},naturalWidth:{value:640,configurable:true},naturalHeight:{value:360,configurable:true}});
    if(!cached)fireEvent.load(image);
    await waitFor(()=>expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0][0]).toMatchObject({filename:'centrabus-GPS-002-qa_1.png'});
    expect(context.drawImage).toHaveBeenCalledTimes(7);
    const labels=context.fillText.mock.calls.map(([text])=>text);
    expect(labels).toContain('CAPTURE DETAILS');
    expect(labels).toContain(detected?'35':'Not detected');
    if(detected){
      expect(labels.filter(text => text === 'Angle: 90.00°')).toHaveLength(6);
      expect(labels).toContain('Below half (E–F) · dial estimate');
      expect(labels).not.toContain('Half · dial estimate');
      expect(labels).toContain('Mid-range · dial estimate');
      expect(labels).toContain('Pressure reading · dial estimate');
    }
    else expect(labels.filter(text => text === 'Angle: —')).toHaveLength(6);
    expect(labels).toContain(detected?"Only this capture's detected values are included.":'No detected values for this image. Older values NOT copied.');
    expect(context.fillRect).toHaveBeenCalledWith(0,0,1540,890);
    ui.unmount();
  }finally{jest.restoreAllMocks();}
});
