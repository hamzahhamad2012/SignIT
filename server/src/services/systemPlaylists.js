export const SYSTEM_PLAYLISTS = [
  {
    name: 'TV_OFF',
    description: 'System playlist that turns the connected display off until normal content resumes.',
    layout_config: { system_action: 'display_off', locked: true },
    bg_color: '#000000',
  },
];

function parseLayoutConfig(playlist) {
  if (playlist?.layout_config && typeof playlist.layout_config === 'object') {
    return playlist.layout_config;
  }

  try {
    return JSON.parse(playlist?.layout_config || '{}');
  } catch {
    return {};
  }
}

export function isSystemPlaylist(playlist) {
  return Boolean(parseLayoutConfig(playlist).system_action);
}

export function getSystemPlaylistAction(playlist) {
  return parseLayoutConfig(playlist).system_action || null;
}

export function decoratePlaylist(playlist) {
  if (!playlist) return playlist;
  playlist.layout_config = parseLayoutConfig(playlist);
  playlist.system_action = playlist.layout_config.system_action || null;
  playlist.is_system = Boolean(playlist.system_action);
  return playlist;
}

export function ensureSystemPlaylists(db) {
  const insert = db.prepare(`
    INSERT INTO playlists (name, description, layout, layout_config, transition, transition_duration, bg_color, is_template)
    VALUES (?, ?, 'fullscreen', ?, 'none', 0, ?, 1)
  `);

  const update = db.prepare(`
    UPDATE playlists
    SET description = ?, layout = 'fullscreen', layout_config = ?, transition = 'none',
        transition_duration = 0, bg_color = ?, is_template = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const deleteItems = db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?');

  for (const playlist of SYSTEM_PLAYLISTS) {
    const existing = db.prepare('SELECT * FROM playlists WHERE name = ?').get(playlist.name);
    const config = JSON.stringify(playlist.layout_config);

    if (existing) {
      update.run(playlist.description, config, playlist.bg_color, existing.id);
      deleteItems.run(existing.id);
    } else {
      const result = insert.run(playlist.name, playlist.description, config, playlist.bg_color);
      deleteItems.run(result.lastInsertRowid);
    }
  }
}
