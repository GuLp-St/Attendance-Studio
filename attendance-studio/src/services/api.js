// CONFIGURATION
const API_URL = "/api";

// --- ADVANCED FINGERPRINTING HELPER ---
const getDeviceId = () => {
    try {
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

        return 'dev_' + Math.abs(hash).toString(16);

    } catch (e) {
        return 'unknown_device';
    }
};

export const api = {
  get: async (endpoint) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
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
    const res = await fetch(`${API_URL}${endpoint}`, {
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
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'DELETE',
      headers: { 'X-Device-ID': getDeviceId() }
    });
    return res.json();
  }
};