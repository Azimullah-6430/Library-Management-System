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

    // 2. Intelligent resolution based on how the page is loaded
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      const hostname = window.location.hostname || 'localhost';

      // If page is served directly by the Express backend on port 5000, use same-origin first
      if (port === '5000') {
        list.push(`${window.location.origin}/api/v1`);
        list.push(`${window.location.origin}/api`);
      }

      // If page is opened on local machine (e.g. Live Server on 5500, Vite on 5173, etc.)
      // the actual Express API is on port 5000 of the same host
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
        list.push('http://localhost:5000/api/v1');
        list.push('http://127.0.0.1:5000/api/v1');
        list.push('http://localhost:5000/api');
        list.push('http://127.0.0.1:5000/api');
      } else {
        // LAN or remote hostname: backend is on port 5000
        list.push(`http://${hostname}:5000/api/v1`);
        if (port === '5000' || port === '' || port === '80' || port === '443') {
          list.push(`${window.location.origin}/api/v1`);
        }
      }
    }

    // Always include standard local loopback fallbacks
    list.push('http://localhost:5000/api/v1');
    list.push('http://127.0.0.1:5000/api/v1');
    list.push('http://localhost:5000/api');
    list.push('http://127.0.0.1:5000/api');

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
