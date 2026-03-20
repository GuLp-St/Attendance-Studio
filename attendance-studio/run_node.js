import fs from "fs";
import { transformSync } from "esbuild";

let code = fs.readFileSync("./src/pages/AdminPanel.jsx", "utf-8");
code = code.replace(/import .*? from .*/g, ""); // strip imports
code = code.replace(/export default /, ""); 
code = `
const React = require('react');
const { useState, useEffect, useMemo } = React;
let api = { post: async () => ({}) };
let getDirectory = async () => [];
let useToast = () => ({ showToast: () => {} });
let useConfirm = () => ({ confirm: async () => true });
let Modal = ({children}) => React.createElement('div', null, children);

${code}

const { renderToString } = require('react-dom/server');
try {
  let A = AdminPanel();
  // Simulate loadData
  let data = {
    logs: [],
    banned_ips: [],
    jobs: [],
    sync_history: [],
    config: {},
    auto_accounts: []
  };
  // We can't easily trigger loadData inside SSR because it uses hooks, but we can just render the component to see if initial state crashes!
  renderToString(A);
} catch(e) {
  console.error("CRASH:", e);
}
`;

let compiled = transformSync(code, { loader: "jsx" });
fs.writeFileSync("./compiled_test.js", compiled.code);
