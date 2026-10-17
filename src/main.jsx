import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './DashboardApp.jsx';
import './index.css';
import { loadDashboardFont } from './nonBlockingFonts';

loadDashboardFont();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
