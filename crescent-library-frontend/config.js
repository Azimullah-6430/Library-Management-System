/**
 * Crescent Library Management System (CLMS)
 * Centralized API & Runtime Configuration
 */
(function (global) {
  'use strict';

  const userConfig = global.__CLMS_CONFIG__ || {};

  function resolveApiCandidates() {
    const list = [];

    // 1. Explicit configured URL (via userConfig or window.CLMS_API)
    if (userConfig.API_URL) list.push(userConfig.API_URL.replace(/\/+$/, ''));
    if (global.CLMS_API) list.push(global.CLMS_API.replace(/\/+$/, ''));

    // 2. Same-origin resolution: If page is loaded over HTTP/HTTPS, origin/api/v1 is primary
    if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
      const origin = window.location.origin;
      list.push(`${origin}/api/v1`);
      // Also include port 5000 on current hostname if accessing via non-5000 dev server (e.g. 5500 or 3000)
      if (window.location.hostname && window.location.port !== '5000') {
        list.push(`http://${window.location.hostname}:5000/api/v1`);
      }
    }

    // 3. Localhost loopback candidates for development and file:/// preview
    list.push('http://127.0.0.1:5000/api/v1');
    list.push('http://localhost:5000/api/v1');

    return [...new Set(list)];
  }

  const candidates = resolveApiCandidates();

  global.CLMS_CONFIG = {
    API_CANDIDATES: candidates,
    API_BASE: candidates[0],
    APP_NAME: 'B.S. Abdur Rahman Crescent Institute of Science and Technology - Central Library',
    TIMEOUT_MS: 10000,
  };
})(typeof window !== 'undefined' ? window : this);

