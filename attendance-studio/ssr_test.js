import fs from 'fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import AdminPanel from './src/pages/AdminPanel';

// Mock contexts
jest.mock('./src/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: () => {} })
}));
jest.mock('./src/contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(true) })
}));
jest.mock('./src/services/api', () => ({
  api: { post: () => Promise.resolve({}) },
  getDirectory: () => Promise.resolve([])
}));

try {
  const html = renderToString(<AdminPanel />);
  console.log("Render successful!");
} catch (e) {
  console.error("RENDER CRASH:", e);
}
