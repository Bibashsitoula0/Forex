import axios from 'axios'

const BASE = '/api'

// Attach the shared API key (set on first load, stored locally) to every
// request. The backend only enforces it when API_KEY is set in its .env,
// so this is a no-op against a local/dev backend with no key configured.
axios.interceptors.request.use((config) => {
  const key = localStorage.getItem('apiKey')
  if (key) config.headers['x-api-key'] = key
  return config
})

axios.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const key = window.prompt('API key required:')
      if (key) {
        localStorage.setItem('apiKey', key)
        window.location.reload()
      }
    }
    return Promise.reject(err)
  }
)

export const fetchChartData  = (tf) => axios.get(`${BASE}/data/${tf}`).then(r => r.data)
export const fetchAllTrends  = ()   => axios.get(`${BASE}/trends`).then(r => r.data)
export const fetchAllSignals = ()   => axios.get(`${BASE}/all-signals`).then(r => r.data)
export const fetchTick       = ()   => axios.get(`${BASE}/tick`).then(r => r.data)
export const fetchJournal    = ()   => axios.get(`${BASE}/journal`).then(r => r.data)
export const fetchPerformance = ()  => axios.get(`${BASE}/performance`).then(r => r.data)
export const addJournalEntry = (e)  => axios.post(`${BASE}/journal`, e).then(r => r.data)
export const deleteJournalEntry = (id) => axios.delete(`${BASE}/journal/${id}`).then(r => r.data)

// Institutional layers
export const fetchIntermarket = ()   => axios.get(`${BASE}/intermarket`).then(r => r.data)
export const fetchSession     = ()   => axios.get(`${BASE}/session`).then(r => r.data)
export const fetchNews        = ()   => axios.get(`${BASE}/news`).then(r => r.data)
export const fetchRiskStatus  = ()   => axios.get(`${BASE}/risk`).then(r => r.data)
export const fetchRegime      = (tf) => axios.get(`${BASE}/regime/${tf}`).then(r => r.data)
export const fetchSettings    = ()   => axios.get(`${BASE}/settings`).then(r => r.data)
export const updateSettings   = (patch) => axios.patch(`${BASE}/settings`, patch).then(r => r.data)
export const setNewsLockout   = (active, durationMinutes = 60) =>
  axios.post(`${BASE}/news/lockout`, { active, durationMinutes }).then(r => r.data)
export const fetchBacktest    = (tf) => axios.get(`${BASE}/backtest/${tf}`).then(r => r.data)
export const executeMT5Trade  = (order) => axios.post(`${BASE}/mt5/execute`, order).then(r => r.data)

// MT5-specific endpoints
export const fetchMT5Status    = () => axios.get(`${BASE}/mt5/status`).then(r => r.data)
export const fetchMT5Tick      = () => axios.get(`${BASE}/mt5/tick`).then(r => r.data)
export const fetchMT5Account   = () => axios.get(`${BASE}/mt5/account`).then(r => r.data)
export const fetchMT5Positions = () => axios.get(`${BASE}/mt5/positions`).then(r => r.data)
export const fetchMT5Symbol    = () => axios.get(`${BASE}/mt5/symbol`).then(r => r.data)
