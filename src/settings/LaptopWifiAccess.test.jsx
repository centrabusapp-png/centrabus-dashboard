import { fireEvent, render, screen } from '@testing-library/react';
import LaptopWifiAccess from './LaptopWifiAccess';

afterEach(() => jest.restoreAllMocks());
test('opens only the local protected Pi2 UI, never SSH, backend changes or Wi-Fi commands from the dashboard', () => {
  const popup = { location: { href: 'about:blank' }, focus: jest.fn() };
  const open = jest.spyOn(window, 'open').mockReturnValue(popup);
  render(<LaptopWifiAccess />);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open Wi-Fi settings' }));
  expect(open).toHaveBeenCalledWith('', 'centrabus-pi2-wifi');
  expect(popup.location.href).toBe('http://127.0.0.1:8765/');
  expect(popup.focus).toHaveBeenCalled();
  expect(screen.getByText('05 - Pi2 Wi-Fi Settings.cmd')).toBeInTheDocument();
});
test('focuses a previously authenticated cross-origin window without replacing its in-memory session', () => {
  const popup = { get location() { throw Error('another origin'); }, focus: jest.fn() };
  jest.spyOn(window, 'open').mockReturnValue(popup);
  render(<LaptopWifiAccess />); fireEvent.click(screen.getByRole('button', { name: 'Open Wi-Fi settings' }));
  expect(popup.focus).toHaveBeenCalled();
});
test('blocked popup gives an actionable launcher fallback', () => {
  jest.spyOn(window, 'open').mockReturnValue(null);
  render(<LaptopWifiAccess />); fireEvent.click(screen.getByRole('button', { name: 'Open Wi-Fi settings' }));
  expect(screen.getByRole('status')).toHaveTextContent('private browser window');
});
