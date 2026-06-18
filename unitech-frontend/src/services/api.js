import axios from 'axios';
import { clearStoredAuth, getLoginRouteForCurrentPath } from './auth';

const api = axios.create({
  baseURL: '',
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearStoredAuth();
      if (!['/login', '/connexion-personnel'].includes(window.location.pathname)) {
        window.location.assign(getLoginRouteForCurrentPath());
      }
    } else if (error.response?.status === 403 && String(error.response?.data?.code || '').startsWith('SUBSCRIPTION_')) {
      if (window.location.pathname !== '/') {
        window.location.assign('/');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
