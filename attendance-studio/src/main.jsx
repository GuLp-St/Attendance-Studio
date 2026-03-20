// attendance-studio/src/main.jsx

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import './assets/style.css'

// --- ADD THIS BLOCK TO KILL THE SERVICE WORKER ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (let registration of registrations) {
      registration.unregister();
    }
  });
}
// ------------------------------------------------

window.addEventListener('error', (event) => {
  const errorDiv = document.createElement('div');
  errorDiv.style.position = 'fixed';
  errorDiv.style.top = '0';
  errorDiv.style.left = '0';
  errorDiv.style.width = '100vw';
  errorDiv.style.height = '100vh';
  errorDiv.style.backgroundColor = 'red';
  errorDiv.style.color = 'white';
  errorDiv.style.zIndex = '999999';
  errorDiv.style.padding = '20px';
  errorDiv.style.overflow = 'auto';
  errorDiv.style.whiteSpace = 'pre-wrap';
  errorDiv.innerHTML = `<h1>Global Error Caught:</h1><pre>${event.error?.stack || event.message}</pre>`;
  document.body.appendChild(errorDiv);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
)