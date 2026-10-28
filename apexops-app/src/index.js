import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import './index.css';
import App from './App';
import SyncStatus from './components/SyncStatus';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><><App /><SyncStatus /><Analytics /></></React.StrictMode>);

if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/service-worker.js').catch(() => {}); });
}
