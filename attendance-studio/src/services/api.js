// CONFIGURATION
const API_URL = "/api";

// --- ADVANCED FINGERPRINTING HELPER ---
const getDeviceId = () => {
    try {
        const storedId = localStorage.getItem('as_device_id');
        if (storedId) return storedId;
        // 1. Canvas Fingerprint (The GPU Signature)
        // We draw a hidden image. Different GPUs render fonts/anti-aliasing slightly differently.
        const getCanvasHash = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.textBaseline = "top";
                ctx.font = "14px 'Arial'";
                ctx.textBaseline = "alphabetic";
                ctx.fillStyle = "#f60";
                ctx.fillRect(125, 1, 62, 20);
                ctx.fillStyle = "#069";
                ctx.fillText("AttendanceStudio_v1", 2, 15);
                ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
                ctx.fillText("AttendanceStudio_v1", 4, 17);
                return canvas.toDataURL(); // Returns a long text string unique to the graphics card
            } catch (e) {
                return 'no_canvas';
            }
        };

        // 2. Collect stable hardware traits
        const traits = [
            navigator.userAgent,                 // Browser Version
            navigator.language,                  // Language
            screen.colorDepth,                   // Color Depth
            screen.width + 'x' + screen.height,  // Resolution
            new Date().getTimezoneOffset(),      // Timezone
            navigator.hardwareConcurrency || 1,  // Number of CPU Cores
            navigator.deviceMemory || 1,         // RAM Amount (approx, Chrome only)
            navigator.platform,                  // OS Platform (Win32, MacIntel, etc)
            getCanvasHash()                      // The GPU Signature
        ].join('||');

        // 3. Hash Function (djb2 algorithm)
        let hash = 0;
        for (let i = 0; i < traits.length; i++) {
            const char = traits.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        const generatedId = 'dev_' + Math.abs(hash).toString(16);
        localStorage.setItem('as_device_id', generatedId);
        return generatedId;

    } catch (e) {
        return 'unknown_device';
    }
};

// --- RETRY HELPER with exponential backoff + jitter ---
// Why not infinite retry: if the server is down, infinite loops amplify load on recovery (thundering herd).
// Jitter spreads out client reconnects so the server isn't hit by everyone simultaneously.
// 5 retries = max ~31s total wait (1 + 2 + 4 + 8 + 16s with jitter ~2-3x them in total)
const fetchWithRetry = async (url, options = {}, retries = 5) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, options);
            // 4xx = client error (bad request, not found, unauthorized) — no retry, won't self-heal
            if (res.status >= 400 && res.status < 500) return res;
            // 5xx = server error or pool exhaustion — retry with backoff
            if (res.status >= 500 && attempt < retries) {
                const base = Math.pow(2, attempt) * 500;          // 500ms, 1s, 2s, 4s, 8s
                const jitter = Math.random() * base;               // randomize ±100% to spread load
                await new Promise(r => setTimeout(r, base + jitter));
                continue;
            }
            return res;
        } catch (networkErr) {
            // True network failure — apply same backoff
            if (attempt < retries) {
                const base = Math.pow(2, attempt) * 500;
                const jitter = Math.random() * base;
                await new Promise(r => setTimeout(r, base + jitter));
            } else {
                // All retries exhausted — notify the app via a DOM event (framework-agnostic)
                window.dispatchEvent(new CustomEvent('atd:apierror', {
                    detail: { message: 'Connection lost. Please check your network.' }
                }));
                throw networkErr;
            }
        }
    }
};

export const api = {
  get: async (endpoint) => {
    const res = await fetchWithRetry(`${API_URL}${endpoint}`, {
        headers: { 'X-Device-ID': getDeviceId() }
    });
    if (!res.ok) {
        let errorMsg = `Error ${res.status}`;
        try {
            const errData = await res.json();
            if(errData.error) errorMsg = errData.error;
        } catch(e) {}
        throw new Error(errorMsg);
    }
    return res.json();
  },
  
  post: async (endpoint, body) => {
    const res = await fetchWithRetry(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 
          'Content-Type': 'application/json',
          'X-Device-ID': getDeviceId()
      },
      body: JSON.stringify(body)
    });
    
    const data = await res.json();
    return data; 
  },
  
  delete: async (endpoint) => {
    const res = await fetchWithRetry(`${API_URL}${endpoint}`, {
      method: 'DELETE',
      headers: { 'X-Device-ID': getDeviceId() }
    });
    return res.json();
  }
};


// --- GLOBAL DICTIONARY CACHE ---
let _directoryCache = null;
let _directoryPromise = null;

export const getDirectory = (force = false) => {
  if (_directoryCache && !force) return Promise.resolve(_directoryCache);
  if (_directoryPromise && !force) return _directoryPromise;
  
  _directoryPromise = api.get('/directory?type=student').then(res => {
      _directoryCache = res;
      _directoryPromise = null;
      return res;
  }).catch(() => {
      _directoryPromise = null;
      return [];
  });
  return _directoryPromise;
};