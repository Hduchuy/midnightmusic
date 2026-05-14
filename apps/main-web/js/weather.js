/*******************************************************************************
 * WEATHER MODULE - Frontend Only
 * 
 * Uses Open-Meteo API (free, no API key required)
 * Browser → Open-Meteo directly (no backend proxy)
 * 
 * Features:
 * - Geolocation-based weather with high accuracy
 * - Fallback to default city (Hanoi) ONLY on denial/unsupported
 * - LocalStorage cache (10 min)
 * - Auto-refresh every 12 minutes
 * - Works on: localhost, Vercel, any HTTPS domain
 * 
 * Debug: Open console to see [Weather] logs
 * 
 * Open-Meteo API docs: https://open-meteo.com/en/docs
 ******************************************************************************/

// Default coordinates (Hanoi, Vietnam) - ONLY used when geolocation fails
const HANOI_COORDS = { lat: 21.0285, lon: 105.8542 };
const DEFAULT_LOCATION = 'Hà Nội';

// Cache settings
const WEATHER_CACHE_KEY = 'cachedWeather';
const WEATHER_CACHE_TIME = 10 * 60 * 1000; // 10 minutes

// Fetch settings
const FETCH_TIMEOUT = 8000;
const GEOLOCATION_TIMEOUT = 15000; // Increased for mobile

// Weather API (Open-Meteo - free, no API key)
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';

// Geocoding API (OpenStreetMap Nominatim - free, no API key)
const GEOCODE_API = 'https://nominatim.openstreetmap.org/reverse';

// Weather code to icon/condition mapping (WMO Weather interpretation codes)
const WEATHER_CODES = {
  0:  { icon: '☀️', condition: 'Trời quang', type: 'clear' },
  1:  { icon: '🌤️', condition: 'Ít mây', type: 'clear' },
  2:  { icon: '⛅', condition: 'Nhiều mây', type: 'clouds' },
  3:  { icon: '☁️', condition: 'Âm u', type: 'clouds' },
  45: { icon: '🌫️', condition: 'Sương mù', type: 'mist' },
  48: { icon: '🌫️', condition: 'Sương mù đóng băng', type: 'mist' },
  51: { icon: '🌦️', condition: 'Mưa phùn nhẹ', type: 'drizzle' },
  53: { icon: '🌦️', condition: 'Mưa phùn', type: 'drizzle' },
  55: { icon: '🌧️', condition: 'Mưa phùn đặc', type: 'drizzle' },
  56: { icon: '🌧️', condition: 'Mưa phùn đóng băng', type: 'drizzle' },
  57: { icon: '🌧️', condition: 'Mưa phùn đóng băng nặng', type: 'drizzle' },
  61: { icon: '🌧️', condition: 'Mưa nhẹ', type: 'rain' },
  63: { icon: '🌧️', condition: 'Mưa vừa', type: 'rain' },
  65: { icon: '🌧️', condition: 'Mưa to', type: 'rain' },
  66: { icon: '🌧️', condition: 'Mưa đóng băng nhẹ', type: 'rain' },
  67: { icon: '🌧️', condition: 'Mưa đóng băng nặng', type: 'rain' },
  71: { icon: '🌨️', condition: 'Tuyết nhẹ', type: 'snow' },
  73: { icon: '🌨️', condition: 'Tuyết vừa', type: 'snow' },
  75: { icon: '❄️', condition: 'Tuyết to', type: 'snow' },
  77: { icon: '🌨️', condition: 'Mưa đá nhỏ', type: 'snow' },
  80: { icon: '🌦️', condition: 'Mưa rào nhẹ', type: 'rain' },
  81: { icon: '🌧️', condition: 'Mưa rào vừa', type: 'rain' },
  82: { icon: '⛈️', condition: 'Mưa rào lớn', type: 'thunderstorm' },
  85: { icon: '🌨️', condition: 'Tuyết rào nhẹ', type: 'snow' },
  86: { icon: '🌨️', condition: 'Tuyết rào nặng', type: 'snow' },
  95: { icon: '⛈️', condition: 'Giông', type: 'thunderstorm' },
  96: { icon: '⛈️', condition: 'Giông kèm mưa đá', type: 'thunderstorm' },
  99: { icon: '⛈️', condition: 'Giông nặng', type: 'thunderstorm' }
};

// Time-based icon override for night
function getNightIcon(code) {
  const isNight = new Date().getHours() >= 18 || new Date().getHours() < 6;
  if (isNight && [0, 1].includes(code)) {
    return { icon: '🌙', condition: 'Trời quang', type: 'clear' };
  }
  return WEATHER_CODES[code] || { icon: '☀️', condition: 'Trời quang', type: 'clear' };
}

function getWeatherInfo(code) {
  return getNightIcon(code);
}

async function fetchWithTimeout(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    console.log('[Weather] Fetch URL:', url);
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

async function getCurrentPosition(timeout = GEOLOCATION_TIMEOUT) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      console.error('[Weather] navigator.geolocation not supported');
      reject(new Error('Geolocation not supported'));
      return;
    }
    
    console.log('[Weather] navigator.geolocation available');
    console.log('[Weather] Requesting position with timeout:', timeout, 'ms');
    
    const geoTimeout = setTimeout(() => {
      console.error('[Weather] Geolocation timeout after', timeout, 'ms');
      reject(new Error('Geolocation timeout'));
    }, timeout);
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(geoTimeout);
        const acc = position.coords.accuracy;
        console.log('[Weather] ✓ Position obtained');
        console.log('[Weather]   Lat:', position.coords.latitude);
        console.log('[Weather]   Lon:', position.coords.longitude);
        console.log('[Weather]   Accuracy:', acc, 'meters');
        console.log('[Weather]   Altitude:', position.coords.altitude);
        console.log('[Weather]   Timestamp:', new Date(position.timestamp).toISOString());
        resolve(position);
      },
      (error) => {
        clearTimeout(geoTimeout);
        let message = 'Geolocation failed';
        let details = '';
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'Location permission denied by user';
            details = 'User chose "Block" or denied permission';
            console.warn('[Weather] ✗ Permission denied:', details);
            break;
          case error.POSITION_UNAVAILABLE:
            message = 'Location unavailable';
            details = 'Device cannot determine location';
            console.error('[Weather] ✗ Position unavailable:', details);
            break;
          case error.TIMEOUT:
            message = 'Location request timeout';
            details = 'Device took too long to respond';
            console.error('[Weather] ✗ Timeout:', details);
            break;
          default:
            console.error('[Weather] ✗ Unknown error:', error.message);
        }
        
        reject(new Error(message));
      },
      {
        enableHighAccuracy: true, // Use GPS when available
        maximumAge: 0, // Always get fresh position
        timeout: timeout
      }
    );
  });
}

async function fetchWeatherData(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    timezone: 'auto'
  });
  
  const url = `${WEATHER_API}?${params.toString()}`;
  console.log('[Weather] API Request:', url);
  
  const data = await fetchWithTimeout(url, FETCH_TIMEOUT);
  
  if (!data.current) {
    throw new Error('Invalid weather response - missing current data');
  }
  
  console.log('[Weather] API Response received');
  console.log('[Weather]   Temp:', data.current.temperature_2m, '°C');
  console.log('[Weather]   Humidity:', data.current.relative_humidity_2m, '%');
  console.log('[Weather]   Weather Code:', data.current.weather_code);
  console.log('[Weather]   Wind:', data.current.wind_speed_10m, 'km/h');
  
  return data.current;
}

async function reverseGeocode(lat, lon) {
  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      format: 'json'
    });
    
    const url = `${GEOCODE_API}?${params.toString()}`;
    console.log('[Weather] Geocoding:', url);
    
    const data = await fetchWithTimeout(url, 5000);
    
    // Try various address fields
    const city = 
      data.address?.city ||
      data.address?.town ||
      data.address?.village ||
      data.address?.municipality ||
      data.address?.county ||
      data.address?.state ||
      data.address?.region ||
      null;
    
    if (city) {
      console.log('[Weather] ✓ Geocoded to:', city);
    } else {
      console.warn('[Weather] Could not determine city from:', JSON.stringify(data.address));
    }
    
    return city;
  } catch (error) {
    console.warn('[Weather] Geocoding failed:', error.message);
    return null;
  }
}

function setLoadingState(message = 'Đang tải...') {
  const tempEl = document.getElementById('wx-temp');
  const iconEl = document.getElementById('wx-icon');
  const condEl = document.getElementById('wx-condition');
  const weatherWidget = document.getElementById('weather-badge');
  
  if (tempEl) tempEl.textContent = '--';
  if (iconEl) iconEl.textContent = '⏳';
  if (condEl) condEl.textContent = message;
  if (weatherWidget) weatherWidget.classList.remove('error');
}

function setErrorState(message = 'Lỗi kết nối') {
  const condEl = document.getElementById('wx-condition');
  const weatherWidget = document.getElementById('weather-badge');
  
  if (condEl) condEl.textContent = message;
  if (weatherWidget) {
    weatherWidget.classList.add('error');
    weatherWidget.classList.add('compact');
  }
}

function renderWeather(data) {
  const weatherWidget = document.getElementById('weather-badge');
  if (!weatherWidget) return;
  
  weatherWidget.classList.remove('error');
  
  const tempEl = document.getElementById('wx-temp');
  if (tempEl) tempEl.textContent = `${Math.round(data.temp)}°C`;
  
  const humidityEl = document.getElementById('wx-humidity');
  if (humidityEl) humidityEl.textContent = `${data.humidity}%`;
  
  const windEl = document.getElementById('wx-wind');
  if (windEl) windEl.textContent = `${Math.round(data.wind)}km/h`;
  
  const wx = getWeatherInfo(data.code);
  const iconEl = document.getElementById('wx-icon');
  const condEl = document.getElementById('wx-condition');
  if (iconEl) iconEl.textContent = wx.icon;
  if (condEl) condEl.textContent = wx.condition;
  
  const locEl = document.getElementById('weather-location');
  if (locEl) locEl.textContent = data.location || 'Không xác định';
  
  const hasLocation = data.location && 
                      data.location.trim() !== '' && 
                      data.location !== 'Không xác định';
  
  if (!hasLocation) {
    weatherWidget.classList.add('compact');
  } else {
    weatherWidget.classList.remove('compact');
  }
  
  console.log('[Weather] Rendered:', {
    location: data.location,
    temp: data.temp + '°C',
    condition: wx.condition,
    icon: wx.icon
  });
}

async function fetchWeather() {
  console.log('━'.repeat(50));
  console.log('[Weather] ═══════════════════════════════════════');
  console.log('[Weather] Weather fetch started');
  console.log('[Weather] Time:', new Date().toISOString());
  console.log('[Weather] User Agent:', navigator.userAgent.substring(0, 50) + '...');
  console.log('[Weather] Secure Context:', window.isSecureContext ? 'Yes' : 'No');
  console.log('[Weather] Protocol:', window.location.protocol);
  
  setLoadingState();
  
  // Check cache
  const cachedData = StorageHelper.get(WEATHER_CACHE_KEY);
  if (cachedData && cachedData.time) {
    const cacheAge = Date.now() - cachedData.time;
    console.log('[Weather] Cache found, age:', Math.round(cacheAge / 1000), 'seconds');
    
    if (cacheAge < WEATHER_CACHE_TIME) {
      console.log('[Weather] Using cached data (fresh)');
      renderWeather(cachedData);
      fetchWeatherFresh(cachedData);
      return;
    } else {
      console.log('[Weather] Cache stale, fetching fresh');
    }
  } else {
    console.log('[Weather] No cache found');
  }
  
  await fetchWeatherFresh(cachedData);
}

async function fetchWeatherFresh(previousCache = null) {
  // Start with default - will override if geolocation succeeds
  let lat = HANOI_COORDS.lat;
  let lon = HANOI_COORDS.lon;
  let locationName = DEFAULT_LOCATION;
  let usedGeolocation = false;
  
  // Try to get user location
  try {
    console.log('[Weather] Attempting geolocation...');
    const position = await getCurrentPosition();
    
    lat = position.coords.latitude;
    lon = position.coords.longitude;
    usedGeolocation = true;
    
    // Try to get city name
    const city = await reverseGeocode(lat, lon);
    locationName = city || 'Không xác định';
    
  } catch (error) {
    console.warn('[Weather] ⚠ Geolocation failed:', error.message);
    console.log('[Weather] Using default location: ' + DEFAULT_LOCATION + ' (' + lat + ', ' + lon + ')');
    // Keep defaults
  }
  
  // Fetch weather using obtained coordinates
  console.log('[Weather] Fetching weather for coords:', lat, lon);
  
  let weatherData = null;
  let fetchSuccess = false;
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[Weather] Weather API attempt ${attempt}/2...`);
      weatherData = await fetchWeatherData(lat, lon);
      fetchSuccess = true;
      break;
    } catch (error) {
      console.warn(`[Weather] API attempt ${attempt} failed:`, error.message);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  if (fetchSuccess && weatherData) {
    const weatherObj = {
      temp: weatherData.temperature_2m,
      humidity: weatherData.relative_humidity_2m,
      wind: weatherData.wind_speed_10m,
      code: weatherData.weather_code,
      location: locationName,
      coords: { lat, lon },
      usedGeolocation: usedGeolocation,
      time: Date.now()
    };
    
    console.log('[Weather] ✓ Weather data obtained');
    console.log('[Weather]   Location:', locationName);
    console.log('[Weather]   Used GPS:', usedGeolocation ? 'Yes' : 'No (default)');
    console.log('[Weather] Final data:', JSON.stringify(weatherObj, null, 2));
    
    StorageHelper.set(WEATHER_CACHE_KEY, weatherObj);
    renderWeather(weatherObj);
  } else {
    console.error('[Weather] ✗ All API attempts failed');
    
    if (previousCache) {
      console.log('[Weather] Falling back to stale cache');
      renderWeather(previousCache);
    } else {
      console.error('[Weather] No fallback available');
      setErrorState('Lỗi kết nối');
    }
  }
  
  console.log('[Weather] Fetch complete');
  console.log('[Weather] ═══════════════════════════════════════');
  console.log('━'.repeat(50));
}

function initWeather() {
  console.log('[Weather] Module initialized');
  fetchWeather();
  
  // Auto-refresh every 12 minutes
  setInterval(fetchWeather, 12 * 60 * 1000);
}
