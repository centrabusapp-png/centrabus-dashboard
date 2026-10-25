import { render, screen, waitFor } from '@testing-library/react';
import LocalNetworkRecovery from './LocalNetworkRecovery';
const config = { localNetworkRecoveryEnabled: true };
test('ordinary/production settings do not create a local recovery request', () => {
  const request = jest.fn();
  render(<LocalNetworkRecovery config={{}} request={request} />);
  expect(request).not.toHaveBeenCalled(); expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
test('current addresses and reconnect phase are shown without calling it a fresh GPS fix', async () => {
  const request = jest.fn(async () => ({ ok: true, json: async () => ({ enabled: true, phase: 'reconnecting', laptopAddress: '192.168.0.174', piAddress: '192.168.0.143', updatedAt: 1000 }) }));
  render(<LocalNetworkRecovery config={config} request={request} />);
  await screen.findByText('Network changed · reconnecting');
  expect(screen.getByText(/Laptop LAN: 192.168.0.174 · Pi2: 192.168.0.143/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('http://127.0.0.1:5000/api/local-session', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  expect(request.mock.calls[0][1].headers).toBeUndefined();
  expect(screen.getByText(/does not prove a fresh GPS fix/)).toBeInTheDocument();
});
test('invalid or unavailable status does not claim a running session', async () => {
  const request = jest.fn(async () => ({ ok: true, json: async () => ({ enabled: true, phase: 'invented' }) }));
  render(<LocalNetworkRecovery config={config} request={request} />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Local launcher status unavailable')).toBeInTheDocument();
});

test.each([
  ['camera-blocked', 'GPS session running · camera needs attention in MAIN CONTROL'],
  ['camera-retrying', 'GPS session running · retrying camera connection'],
])('camera-only %s does not claim GPS or backend has stopped', async (phase, caption) => {
  const request = jest.fn(async () => ({ ok: true, json: async () => ({ enabled: true, phase, updatedAt: 1000 }) }));
  render(<LocalNetworkRecovery config={config} request={request} />);
  expect(await screen.findByText(caption)).toBeInTheDocument();
});
