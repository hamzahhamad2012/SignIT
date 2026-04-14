const BASE = '/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('signit_token');
  const headers = { ...options.headers };

  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('Cannot reach server — make sure the backend is running on port 4000.');
  }

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON response */ }

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('signit_token');
      window.location.href = '/login';
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, {
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body),
  }),
  put: (path, body) => request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: (path, file, fields = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    return request(path, { method: 'POST', body: formData });
  },
};
