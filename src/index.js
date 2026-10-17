import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './DashboardApp.jsx';
import './index.css';
import { loadDashboardFont } from './nonBlockingFonts';

loadDashboardFont();

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
