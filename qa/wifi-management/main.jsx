// Development-only review. Imports NO Auth, Supabase or dashboard runtime.
// No production mock/status injection: use the actual pending integration UI.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import WifiManagement from '../../src/settings/WifiManagement.jsx';
import '../../src/index.css';

function LocalReview() {
  const [width, setWidth] = useState('1200');
  return <main style={{ background: '#f4f6f8', minHeight: '100vh', padding: 16 }}>
    <header style={{ marginBottom: 16, color: '#475569', fontSize: 14 }}>
      <strong>Local UI review only · no device or database access</strong>
      <label style={{ display: 'block', marginTop: 8 }}>Review width{' '}
        <select aria-label="Review width" value={width} onChange={(event) => setWidth(event.target.value)}>
          <option value="1200">Desktop · 1200px</option><option value="720">Tablet · 720px</option><option value="328">Mobile · 328px content / 360px viewport</option>
        </select>
      </label>
    </header>
    <div style={{ width: Number(width), maxWidth: '100%', margin: '0 auto' }}><WifiManagement authorized /></div>
  </main>;
}
createRoot(document.getElementById('root')).render(<LocalReview />);
