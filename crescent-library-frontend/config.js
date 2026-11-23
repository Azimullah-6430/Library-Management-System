/**
 * Crescent Library Management System (CLMS)
 * Centralized API & Production Runtime Configuration
 * Supports Localhost, Render (Backend), and Vercel (Frontend)
 */
(function (global) {
  'use strict';

  // ── Render Production Backend URL ───────────────────────────────────────────
  // If your backend is deployed on Render, paste its URL here (e.g. https://your-service.onrender.com)
  const DEFAULT_PRODUCTION_RENDER_URL = 'https://crescent-library-backend.onrender.com';

  const userConfig = global.__CLMS_CONFIG__ || {};

  function resolveApiCandidates() {
    const list = [];
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const hostname = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';

    // 1. Explicit configured URL via URL parameter (?api=https://... or ?backend=https://...)
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      try {
        const params = new URLSearchParams(window.location.search);
        const queryApi = params.get('api') || params.get('backend');
        if (queryApi) {
          const clean = queryApi.replace(/\/+$/, '');
          const withV1 = clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`;
          list.push(withV1);
          localStorage.setItem('clms_backend_url', clean);
        }
      } catch (_) {}
    }

    // 2. Stored backend URL from localStorage
    try {
      const storedApi = localStorage.getItem('clms_backend_url');
      if (storedApi) {
        const clean = storedApi.replace(/\/+$/, '');
        list.push(clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`);
      }
    } catch (_) {}

    // 3. User configured window.CLMS_CONFIG or window.CLMS_API
    if (userConfig.API_URL) {
      const u = userConfig.API_URL.replace(/\/+$/, '');
      list.push(u.endsWith('/api/v1') ? u : `${u}/api/v1`);
    }
    if (global.CLMS_API) {
      const g = global.CLMS_API.replace(/\/+$/, '');
      list.push(g.endsWith('/api/v1') ? g : `${g}/api/v1`);
    }

    // 4. Same-origin relative path (for Vercel rewrites or self-hosted Express)
    if (typeof window !== 'undefined' && window.location.origin) {
      list.push(`${window.location.origin}/api/v1`);
      list.push(`${window.location.origin}/api`);
    }

    // 5. Configured Render Production URL
    if (DEFAULT_PRODUCTION_RENDER_URL) {
      const r = DEFAULT_PRODUCTION_RENDER_URL.replace(/\/+$/, '');
      list.push(r.endsWith('/api/v1') ? r : `${r}/api/v1`);
    }

    // 6. Local development (ONLY if running locally and NOT over HTTPS)
    if (isLocalhost && !isHttps) {
      list.push('http://localhost:5000/api/v1');
      list.push('http://127.0.0.1:5000/api/v1');
      list.push('http://localhost:5000/api');
      list.push('http://127.0.0.1:5000/api');
    }

    // CRITICAL: Filter out any insecure HTTP URLs when page is loaded over HTTPS
    // This completely eliminates "Mixed Content" blocks on Vercel
    const sanitized = list.filter((url) => {
      if (!url) return false;
      if (isHttps && url.startsWith('http://')) return false;
      return true;
    });

    return [...new Set(sanitized)];
  }

  const candidates = resolveApiCandidates();

  global.CLMS_CONFIG = {
    API_CANDIDATES: candidates,
    API_BASE: candidates[0],
    PRODUCTION_RENDER_URL: DEFAULT_PRODUCTION_RENDER_URL,
    APP_NAME: 'B.S. Abdur Rahman Crescent Institute of Science and Technology - Central Library',
    TIMEOUT_MS: 10000,
  };
})(typeof window !== 'undefined' ? window : this);
