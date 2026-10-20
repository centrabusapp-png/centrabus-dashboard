import { render, screen, waitFor } from '@testing-library/react';
import CameraFrameGaugePanel from './CameraFrameGaugePanel';
import { FRAME_GAUGE_KEYS } from './cameraFrameService';
const NOW=Date.parse('2026-10-20T04:00:00.000Z'); const clock=()=>NOW;
test('vehicle condition uses one camera snapshot without GPS freshness or fabricated Normal labels',async()=>{
  const frame={device_id:'GPS-002',camera_id:'test-cam',bus_id:'selected-bus',capture_id:'source:1',captured_at:new Date(NOW-1000).toISOString(),
    readings:FRAME_GAUGE_KEYS.map(gauge_key=>({gauge_key,value:42,quality:'detected',unit:'%',dial_percent:42}))};
  const service={readForBus:jest.fn(async()=>({state:'live',frame}))};
  render(<CameraFrameGaugePanel busId="selected-bus" service={service} clock={clock}/>);
  await waitFor(()=>expect(screen.getAllByText('42')).toHaveLength(6));
  expect(service.readForBus).toHaveBeenCalledWith('selected-bus',expect.objectContaining({signal:expect.anything()}));
  expect(screen.getByLabelText('Same-capture gauge observations')).toHaveAttribute('data-capture-id','source:1');
  expect(screen.queryByText(/^Normal$/)).not.toBeInTheDocument();
});
