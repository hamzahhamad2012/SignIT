export const DISPLAY_ROTATIONS = [
  { value: 'landscape', label: 'Landscape', degrees: 0, orientation: 'landscape' },
  { value: 'landscape-flipped', label: 'Landscape Flipped', degrees: 180, orientation: 'landscape' },
  { value: 'portrait-right', label: 'Portrait Right', degrees: 90, orientation: 'portrait' },
  { value: 'portrait-left', label: 'Portrait Left', degrees: 270, orientation: 'portrait' },
];

const ROTATION_BY_VALUE = new Map(DISPLAY_ROTATIONS.map((rotation) => [rotation.value, rotation]));
const LEGACY_ALIASES = {
  portrait: 'portrait-right',
  inverted: 'landscape-flipped',
  flipped: 'landscape-flipped',
  '90': 'portrait-right',
  '180': 'landscape-flipped',
  '270': 'portrait-left',
  '-90': 'portrait-left',
};

export function normalizeDisplayRotation(value, fallback = 'landscape') {
  const normalized = value === undefined || value === null || value === ''
    ? fallback
    : String(value).trim().toLowerCase();
  const canonical = LEGACY_ALIASES[normalized] || normalized;
  return ROTATION_BY_VALUE.has(canonical) ? canonical : fallback;
}

export function getDisplayRotation(value, fallback = 'landscape') {
  return ROTATION_BY_VALUE.get(normalizeDisplayRotation(value, fallback)) || ROTATION_BY_VALUE.get('landscape');
}

export function getDeviceDisplayRotation(device) {
  let settings = {};
  try {
    settings = typeof device.settings === 'string'
      ? JSON.parse(device.settings || '{}')
      : (device.settings || {});
  } catch {
    settings = {};
  }

  return getDisplayRotation(settings.display_rotation || device.display_rotation || device.orientation || 'landscape');
}
