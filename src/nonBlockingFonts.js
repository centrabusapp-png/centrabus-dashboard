const FONT_LINK_ID = 'centrabus-web-font';
const FONT_STYLESHEET = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap';

// The system font is immediately readable, even when Google Fonts is slow or
// unavailable. A dynamically inserted stylesheet does not block first paint.
export function loadDashboardFont(doc = document) {
  if (doc.getElementById(FONT_LINK_ID)) return;
  const link = doc.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = FONT_STYLESHEET;
  link.addEventListener('error', () => link.remove(), { once: true });
  doc.head.appendChild(link);
}
