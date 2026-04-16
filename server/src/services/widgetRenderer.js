import QRCode from 'qrcode';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeCss(value, fallback) {
  const text = String(value || fallback || '').trim();
  return /[<>{}]/.test(text) ? fallback : text;
}

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchRssTitles(url, maxItems) {
  if (!url) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

    return items
      .map((item) => item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
      .filter(Boolean)
      .map((title) => decodeXmlEntities(title).trim())
      .filter(Boolean)
      .slice(0, maxItems);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function widgetShell({ title, body, style = {} }) {
  const bg = safeCss(style.bg || style.background, 'transparent');
  const color = safeCss(style.color, '#ffffff');
  const fontFamily = safeCss(style.fontFamily, 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title || 'SignIT Widget')}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${bg};
      color: ${color};
      font-family: ${fontFamily};
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .widget-root {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
    }
  </style>
</head>
<body>
  <main class="widget-root">${body}</main>
</body>
</html>`;
}

function renderClock(widget, config, style) {
  const hour12 = config.hour12 !== false;
  const showDate = config.showDate !== false;
  const timezone = config.timezone ? `'${escapeHtml(config.timezone)}'` : 'undefined';
  const fontSize = safeCss(style.fontSize, 'clamp(56px, 12vw, 180px)');
  const dateSize = safeCss(style.dateSize, 'clamp(20px, 4vw, 52px)');

  return widgetShell({
    title: widget.name,
    style,
    body: `
      <section style="text-align:center;line-height:1;">
        <div id="time" style="font-size:${fontSize};font-weight:800;letter-spacing:-0.06em;"></div>
        ${showDate ? `<div id="date" style="margin-top:18px;font-size:${dateSize};opacity:.68;font-weight:500;"></div>` : ''}
      </section>
      <script>
        function updateClock() {
          var now = new Date();
          var options = { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: ${hour12}, timeZone: ${timezone} };
          document.getElementById('time').textContent = now.toLocaleTimeString([], options);
          var date = document.getElementById('date');
          if (date) date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: ${timezone} });
        }
        updateClock();
        setInterval(updateClock, 1000);
      </script>`,
  });
}

function renderTicker(widget, config, style) {
  const messages = Array.isArray(config.messages) && config.messages.length
    ? config.messages
    : ['Welcome to SignIT'];
  const speed = Math.max(5, Number(config.speed || 22));
  const fontSize = safeCss(style.fontSize, 'clamp(26px, 5vw, 76px)');
  const separator = escapeHtml(config.separator || '|');

  return widgetShell({
    title: widget.name,
    style: { ...style, bg: style.bg || '#050505' },
    body: `
      <section style="width:100%;overflow:hidden;white-space:nowrap;">
        <div style="display:inline-block;padding-left:100%;animation:ticker ${speed}s linear infinite;font-size:${fontSize};font-weight:800;">
          ${messages.map((message) => `<span style="padding:0 42px;">${escapeHtml(message)}</span><span style="opacity:.45">${separator}</span>`).join('')}
        </div>
      </section>
      <style>
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-100%); } }
      </style>`,
  });
}

async function renderQr(widget, config, style) {
  const url = String(config.url || '').trim() || 'https://example.com';
  const label = config.label ? escapeHtml(config.label) : '';
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 512, color: { dark: '#111111', light: '#ffffff' } });

  return widgetShell({
    title: widget.name,
    style: { ...style, bg: style.bg || '#101014' },
    body: `
      <section style="text-align:center;">
        <div style="display:inline-flex;flex-direction:column;gap:18px;align-items:center;background:#fff;color:#111;padding:34px;border-radius:28px;box-shadow:0 24px 80px rgba(0,0,0,.35);">
          <img src="${qr}" alt="QR code" style="width:min(52vh,52vw,420px);height:auto;display:block;" />
          ${label ? `<div style="font-size:clamp(20px,3vw,40px);font-weight:800;">${label}</div>` : ''}
        </div>
      </section>`,
  });
}

function renderCounter(widget, config, style) {
  const value = Number(config.value || 0);
  const prefix = escapeHtml(config.prefix || '');
  const suffix = escapeHtml(config.suffix || '');
  const label = escapeHtml(config.label || widget.name);
  const fontSize = safeCss(style.fontSize, 'clamp(64px, 13vw, 190px)');

  return widgetShell({
    title: widget.name,
    style,
    body: `
      <section style="text-align:center;">
        <div style="font-size:clamp(20px,4vw,54px);opacity:.64;text-transform:uppercase;letter-spacing:.12em;">${label}</div>
        <div style="font-size:${fontSize};font-weight:900;letter-spacing:-.08em;margin-top:18px;">
          ${prefix}<span id="count">0</span>${suffix}
        </div>
      </section>
      <script>
        var target = ${Number.isFinite(value) ? value : 0};
        var start = performance.now();
        function tick(now) {
          var p = Math.min(1, (now - start) / 1200);
          var eased = 1 - Math.pow(1 - p, 3);
          document.getElementById('count').textContent = Math.round(target * eased).toLocaleString();
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      </script>`,
  });
}

function renderWeather(widget, config, style) {
  const location = escapeHtml(config.location || 'Set location');
  const temp = escapeHtml(config.temp || '--');
  const unit = escapeHtml(config.unit || 'F');
  const condition = escapeHtml(config.condition || 'Weather');
  const icon = escapeHtml(config.icon || 'Sunny');
  const latitude = Number(config.latitude);
  const longitude = Number(config.longitude);
  const hasLiveWeather = Number.isFinite(latitude) && Number.isFinite(longitude);
  const temperatureUnit = config.unit === 'C' ? 'celsius' : 'fahrenheit';

  return widgetShell({
    title: widget.name,
    style: { ...style, bg: style.bg || 'linear-gradient(135deg,#0f766e,#0f172a)' },
    body: `
      <section style="text-align:center;">
        <div id="weatherIcon" style="font-size:clamp(72px,14vw,180px);line-height:1;">${icon}</div>
        <div style="font-size:clamp(56px,12vw,160px);font-weight:900;letter-spacing:-.08em;"><span id="weatherTemp">${temp}</span>&deg;<span id="weatherUnit">${unit}</span></div>
        <div id="weatherCondition" style="font-size:clamp(22px,4vw,52px);font-weight:700;">${condition}</div>
        <div style="margin-top:10px;font-size:clamp(18px,3vw,36px);opacity:.72;">${location}</div>
      </section>
      ${hasLiveWeather ? `<script>
        var weatherNames = {
          0: ['Clear', 'Sunny'], 1: ['Mostly clear', 'Sunny'], 2: ['Partly cloudy', 'Cloudy'],
          3: ['Cloudy', 'Cloudy'], 45: ['Fog', 'Fog'], 48: ['Fog', 'Fog'],
          51: ['Drizzle', 'Rain'], 53: ['Drizzle', 'Rain'], 55: ['Drizzle', 'Rain'],
          61: ['Rain', 'Rain'], 63: ['Rain', 'Rain'], 65: ['Heavy rain', 'Rain'],
          71: ['Snow', 'Snow'], 73: ['Snow', 'Snow'], 75: ['Heavy snow', 'Snow'],
          80: ['Showers', 'Rain'], 81: ['Showers', 'Rain'], 82: ['Heavy showers', 'Rain'],
          95: ['Thunderstorm', 'Storm']
        };
        async function updateWeather() {
          try {
            var url = 'https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=${temperatureUnit}';
            var response = await fetch(url);
            if (!response.ok) return;
            var data = await response.json();
            var current = data.current || {};
            var details = weatherNames[current.weather_code] || ['Weather', 'Weather'];
            document.getElementById('weatherTemp').textContent = Math.round(current.temperature_2m);
            document.getElementById('weatherUnit').textContent = '${unit}';
            document.getElementById('weatherCondition').textContent = details[0];
            document.getElementById('weatherIcon').textContent = details[1];
          } catch (e) {}
        }
        updateWeather();
        setInterval(updateWeather, 15 * 60 * 1000);
      </script>` : ''}`,
  });
}

async function renderRss(widget, config, style) {
  const title = escapeHtml(config.title || 'RSS Headlines');
  const maxItems = Math.max(1, Number(config.maxItems || 5) || 5);
  const liveItems = await fetchRssTitles(config.url, maxItems);
  const items = liveItems.length
    ? liveItems
    : Array.isArray(config.items) && config.items.length
    ? config.items
    : ['Add headlines in the widget settings', config.url || 'RSS feed URL saved'];

  return widgetShell({
    title: widget.name,
    style: { ...style, bg: style.bg || '#0c0a09' },
    body: `
      <section style="width:min(1500px,100%);">
        <h1 style="margin:0 0 28px;font-size:clamp(34px,6vw,92px);letter-spacing:-.05em;">${title}</h1>
        <div style="display:grid;gap:18px;">
          ${items.slice(0, maxItems).map((item) => `<article style="padding:22px 26px;border-radius:20px;background:rgba(255,255,255,.08);font-size:clamp(22px,3vw,46px);font-weight:700;">${escapeHtml(item)}</article>`).join('')}
        </div>
      </section>`,
  });
}

function renderCustomHtml(widget, config, style) {
  return widgetShell({
    title: widget.name,
    style,
    body: config.html || '<div style="font-size:64px;font-weight:800;">Custom widget</div>',
  });
}

export async function renderWidgetDocument(widget) {
  const config = typeof widget.config === 'string' ? JSON.parse(widget.config || '{}') : (widget.config || {});
  const style = typeof widget.style === 'string' ? JSON.parse(widget.style || '{}') : (widget.style || {});

  switch (widget.type) {
    case 'clock':
      return renderClock(widget, config, style);
    case 'ticker':
      return renderTicker(widget, config, style);
    case 'qr':
      return renderQr(widget, config, style);
    case 'counter':
      return renderCounter(widget, config, style);
    case 'weather':
      return renderWeather(widget, config, style);
    case 'rss':
      return renderRss(widget, config, style);
    case 'custom_html':
      return renderCustomHtml(widget, config, style);
    default:
      return widgetShell({
        title: widget.name,
        style,
        body: '<div style="font-size:64px;font-weight:800;">Widget ready</div>',
      });
  }
}
