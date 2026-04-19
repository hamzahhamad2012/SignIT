export const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'admin' CHECK(role IN ('admin','editor','viewer')),
    status TEXT DEFAULT 'active' CHECK(status IN ('pending','active','disabled')),
    approved_at DATETIME,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_device_permissions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, device_id)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#3b82f6',
    default_playlist_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME,
    status TEXT DEFAULT 'offline' CHECK(status IN ('online','offline','error')),
    ip_address TEXT,
    mac_address TEXT,
    resolution TEXT DEFAULT '1920x1080',
    orientation TEXT DEFAULT 'landscape' CHECK(orientation IN ('landscape','portrait')),
    os_info TEXT,
    player_version TEXT,
    current_playlist_id INTEGER,
    assigned_playlist_id INTEGER,
    cpu_temp REAL,
    cpu_usage REAL,
    memory_usage REAL,
    disk_usage REAL,
    uptime INTEGER,
    screenshot TEXT,
    settings TEXT DEFAULT '{}',
    tags TEXT DEFAULT '[]',
    location_name TEXT,
    location_address TEXT,
    location_city TEXT,
    location_state TEXT,
    location_zip TEXT,
    location_country TEXT,
    location_lat REAL,
    location_lng REAL,
    location_notes TEXT
  );

  CREATE TABLE IF NOT EXISTS pairing_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
    location_name TEXT,
    location_address TEXT,
    location_city TEXT,
    location_state TEXT,
    location_zip TEXT,
    location_country TEXT,
    used_by TEXT REFERENCES devices(id) ON DELETE SET NULL,
    used_at DATETIME,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS asset_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES asset_folders(id) ON DELETE SET NULL,
    color TEXT DEFAULT '#6366f1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(parent_id, name)
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('image','video','html','url','widget','stream')),
    folder_id INTEGER REFERENCES asset_folders(id) ON DELETE SET NULL,
    filename TEXT,
    original_name TEXT,
    mime_type TEXT,
    size INTEGER DEFAULT 0,
    width INTEGER,
    height INTEGER,
    duration REAL,
    thumbnail TEXT,
    url TEXT,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    layout TEXT DEFAULT 'fullscreen' CHECK(layout IN ('fullscreen','split-h','split-v','grid-4','l-bar','custom')),
    layout_config TEXT DEFAULT '{}',
    transition TEXT DEFAULT 'fade' CHECK(transition IN ('fade','slide-left','slide-right','slide-up','zoom','none')),
    transition_duration INTEGER DEFAULT 800,
    bg_color TEXT DEFAULT '#000000',
    is_template BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    zone TEXT DEFAULT 'main',
    position INTEGER NOT NULL,
    duration INTEGER DEFAULT 10,
    fit TEXT DEFAULT 'cover' CHECK(fit IN ('cover','contain','fill','none')),
    muted BOOLEAN DEFAULT 1,
    settings TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    start_time TEXT,
    end_time TEXT,
    days_of_week TEXT DEFAULT '0,1,2,3,4,5,6',
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    device_id TEXT,
    category TEXT DEFAULT 'system',
    action TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS player_update_jobs (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    target_version TEXT NOT NULL,
    force BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'queued' CHECK(status IN ('queued','sent','checking','downloading','installing','success','failed','current')),
    progress INTEGER DEFAULT 0,
    eta_seconds INTEGER,
    message TEXT,
    requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,
    completed_at DATETIME,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS display_walls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    cols INTEGER DEFAULT 1,
    rows INTEGER DEFAULT 3,
    bezel_mm REAL DEFAULT 5,
    bg_color TEXT DEFAULT '#1a1a1a',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wall_screens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wall_id INTEGER NOT NULL REFERENCES display_walls(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
    col INTEGER NOT NULL DEFAULT 0,
    row INTEGER NOT NULL DEFAULT 0,
    col_span INTEGER DEFAULT 1,
    row_span INTEGER DEFAULT 1,
    orientation TEXT DEFAULT 'landscape' CHECK(orientation IN ('landscape','portrait')),
    label TEXT,
    settings TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('clock','weather','ticker','rss','social','counter','qr','custom_html')),
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    config TEXT DEFAULT '{}',
    style TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'general' CHECK(category IN ('general','menu','retail','corporate','hospitality','education','healthcare')),
    thumbnail TEXT,
    html_content TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    is_builtin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(group_id);
  CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
  CREATE INDEX IF NOT EXISTS idx_asset_folders_parent ON asset_folders(parent_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_playlist ON schedules(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_active ON schedules(is_active);
  CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_update_jobs_status ON player_update_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_wall_screens_wall ON wall_screens(wall_id);
  CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(type);
  CREATE INDEX IF NOT EXISTS idx_pairing_tokens_code ON pairing_tokens(code);
`;
