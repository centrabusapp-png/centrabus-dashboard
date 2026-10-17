import { loadDashboardFont } from './nonBlockingFonts';

afterEach(() => document.getElementById('centrabus-web-font')?.remove());

test('optional font stylesheet is non-blocking and added only once', () => {
  loadDashboardFont();
  loadDashboardFont();
  const link = document.getElementById('centrabus-web-font');
  expect(link).toHaveAttribute('rel', 'stylesheet');
  expect(link).not.toHaveAttribute('blocking');
  expect(link.href).toContain('display=swap');
  expect(document.querySelectorAll('#centrabus-web-font')).toHaveLength(1);
});

test('font network failure removes the optional link without preventing app startup', () => {
  loadDashboardFont();
  document.getElementById('centrabus-web-font').dispatchEvent(new Event('error'));
  expect(document.getElementById('centrabus-web-font')).toBeNull();
});
