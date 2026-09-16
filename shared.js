/* ==========================================================================
   GcseVault - shared.js
   Reusable functionality for dates, quotes, and feedback pages.
   ========================================================================== */

// --- 1. LOCAL STORAGE HELPERS ---
const Storage = {
  get(key, fallback = []) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      console.error(`Error reading ${key} from localStorage:`, e);
      return fallback;
    }
  },

  set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error(`Error saving ${key} to localStorage:`, e);
      return false;
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  }
};

// --- 2. SETTINGS MANAGEMENT ---
const Settings = {
  // Default user configuration
  defaults: {
    theme: 'dark',
    fontSize: 'medium',
    reduceAnimations: false
  },

  // Load and apply saved settings on initialization
  init() {
    const savedSettings = { ...this.defaults, ...Storage.get('gcse_vault_settings', {}) };
    this.apply(savedSettings);
    return savedSettings;
  },

  // Apply settings to DOM elements
  apply(settings) {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute('data-font-size', settings.fontSize);
    
    if (settings.reduceAnimations) {
      document.body.classList.add('reduce-motion');
    } else {
      document.body.classList.remove('reduce-motion');
    }
  },

  // Update a single setting
  update(key, value) {
    const current = Storage.get('gcse_vault_settings', this.defaults);
    current[key] = value;
    Storage.set('gcse_vault_settings', current);
    this.apply(current);
  },

  // Wipe all user data stored across the site
  resetAllData() {
    if (confirm("Are you sure you want to clear all custom dates, quotes, and saved preferences?")) {
      localStorage.clear();
      window.location.reload();
    }
  }
};

// --- 3. UI & COMPONENT INJECTORS ---
const UI = {
  // Mobile Navigation Toggle
  initMobileMenu() {
    const toggleBtn = document.querySelector('.nav-toggle');
    const navMenu = document.querySelector('.nav-menu');
    
    if (toggleBtn && navMenu) {
      toggleBtn.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        toggleBtn.setAttribute('aria-expanded', navMenu.classList.contains('active'));
      });
    }
  },

  // Toast Notification System
  showToast(message, type = 'info', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, duration);
  },

  // Sanitize raw text before rendering into HTML to prevent XSS
  escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
};

// --- 4. INTERACTIVE STUDY UTILITIES (Quotes & Dates) ---
const StudyTools = {
  // Fisher-Yates Array Shuffle Algorithm
  shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  // Filter list by search query (works on objects with text, title, tags, or date fields)
  filterItems(items, query) {
    const cleanQuery = query.toLowerCase().trim();
    if (!cleanQuery) return items;

    return items.filter(item => {
      return Object.values(item).some(val => 
        String(val).toLowerCase().includes(cleanQuery)
      );
    });
  },

  // General Flashcard Flip Event Handler
  bindCardFlips(cardSelector = '.card') {
    document.querySelectorAll(cardSelector).forEach(card => {
      card.addEventListener('click', () => {
        card.classList.toggle('is-flipped');
      });
    });
  }
};

// --- 5. FORM HELPERS ---
const FormHelpers = {
  // Basic non-empty text check
  validateRequired(formElement) {
    let isValid = true;
    const inputs = formElement.querySelectorAll('[required]');
    
    inputs.forEach(input => {
      if (!input.value.trim()) {
        isValid = false;
        input.classList.add('error');
      } else {
        input.classList.remove('error');
      }
    });

    return isValid;
  }
};
// --- 6. TEXT & CONTENT FORMATTING ---
const Formatters = {
  // Truncate long texts (e.g., long quotes or descriptions) with an ellipsis
  truncateText(text, maxLength = 100) {
    if (!text || text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trim()}...`;
  },

  // Highlight specific search terms in rendered text
  highlightMatch(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark class="highlight">$1</mark>');
  },

  // Pretty-print dates (useful for History dates or timeline entries)
  formatDate(dateString, options = {}) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // Return raw string if non-standard date (e.g., "1066 BC")

    const defaultOptions = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-GB', { ...defaultOptions, ...options });
  }
};

// --- 7. DOM BUILDERS & TEMPLATES ---
const DOMBuilder = {
  // Create HTML elements dynamically with classes, attributes, and content
  createElement(tag, options = {}) {
    const element = document.createElement(tag);
    
    if (options.className) element.className = options.className;
    if (options.text) element.textContent = options.text;
    if (options.html) element.innerHTML = options.html;
    
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([key, val]) => {
        element.setAttribute(key, val);
      });
    }

    return element;
  },

  // Render standardized Flashcard DOM layout (Works for both History Events & English Quotes)
  createCard({ title, body, tag, id }) {
    const card = this.createElement('div', { 
      className: 'vault-card',
      attrs: { 'data-id': id }
    });

    card.innerHTML = `
      <div class="card-inner">
        <div class="card-front">
          <span class="card-tag">${UI.escapeHTML(tag || 'General')}</span>
          <h3 class="card-title">${UI.escapeHTML(title)}</h3>
          <span class="flip-hint">Click to flip 🔄</span>
        </div>
        <div class="card-back">
          <p class="card-body">${UI.escapeHTML(body)}</p>
        </div>
      </div>
    `;

    return card;
  },

  // Render empty state placeholder when searches yield 0 results
  createEmptyState(message = "No items found matching your filter.") {
    return `
      <div class="empty-state">
        <p class="empty-message">${UI.escapeHTML(message)}</p>
      </div>
    `;
  }
};
// --- 8. SHARED USER PROFILE + THEME HELPERS ---
const VaultUser = {
  WORKER_URL: 'https://quotevault-api.noah-l-barker.workers.dev',

  getUsername() {
    return localStorage.getItem('vault_username') || null;
  },

  setUsername(value) {
    if (!value) return null;
    localStorage.setItem('vault_username', value);
    return value;
  },

  getKey() {
    return localStorage.getItem('vault_userKey') || null;
  },

  setKey(value) {
    if (!value) return null;
    localStorage.setItem('vault_userKey', value);
    return value;
  },

  getProfile() {
    return {
      username: this.getUsername(),
      userKey: this.getKey(),
      theme: localStorage.getItem('vt_theme') || 'default'
    };
  },

  saveProfile(partial = {}) {
    const profile = { ...this.getProfile(), ...partial };
    if (profile.username) localStorage.setItem('vault_username', profile.username);
    if (profile.userKey) localStorage.setItem('vault_userKey', profile.userKey);
    if (profile.theme) localStorage.setItem('vt_theme', profile.theme);
    return profile;
  },

  clearStaleLegacyKeys() {
    [
      'dv_username', 'qv_username', 'lb_userKey', 'qv_userKey', 'dv_userKey',
      'qv_set', 'dv_set', 'qv_ach', 'dv_ach'
    ].forEach((key) => {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
      }
    });
  },

  async syncProfileToWorker(payload = {}) {
    const profile = this.getProfile();
    const userKey = payload.userKey || profile.userKey || this.getKey();
    if (!userKey || !profile.username) {
      return null;
    }

    const requestBody = {
      ...profile,
      ...payload,
      userKey,
      username: payload.username || profile.username
    };

    try {
      const response = await fetch(`${this.WORKER_URL}/lb/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (data.userKey && data.userKey !== userKey) {
        this.setKey(data.userKey);
      }

      return data;
    } catch (error) {
      console.warn('User profile sync failed:', error);
      return null;
    }
  }
};

const ThemeManager = {
  WORKER_URL: VaultUser.WORKER_URL,

  THEME_VAR_GROUPS: [
    { group: 'Backgrounds', vars: [
      ['Background (deepest)', '--bg'],
      ['Background 2 (sidebar/topbar)', '--bg2'],
      ['Background 3 (surface)', '--bg3'],
      ['Background 4', '--bg4'],
      ['Background 5 (lightest)', '--bg5'],
      ['Card', '--card']
    ]},
    { group: 'Borders', vars: [
      ['Border (subtle)', '--border'],
      ['Border 2 (normal)', '--border2'],
      ['Border 3 (strong)', '--border3']
    ]},
    { group: 'Text', vars: [
      ['Text (primary)', '--text'],
      ['Text 2 (muted)', '--text2'],
      ['Text 3 (faint)', '--text3']
    ]},
    { group: 'Gold / Accent', vars: [
      ['Gold', '--gold'],
      ['Gold 2 (lighter)', '--gold2'],
      ['Gold 3 (darker)', '--gold3']
    ]},
    { group: 'Purple / Primary', vars: [
      ['Purple', '--purple'],
      ['Purple 2 (hover)', '--purple2'],
      ['Purple 3 (light)', '--purple3']
    ]},
    { group: 'Teal / Success', vars: [
      ['Teal', '--teal'],
      ['Teal 2', '--teal2']
    ]},
    { group: 'Coral / Danger', vars: [
      ['Coral', '--coral'],
      ['Coral 2', '--coral2']
    ]},
    { group: 'Misc Accents', vars: [
      ['Blue', '--blue'],
      ['Pink', '--pink'],
      ['Amber', '--amber'],
      ['Green', '--green'],
      ['Red', '--red']
    ]}
  ],

  defaultThemes: {
    default: {
      label: 'Vault',
      desc: 'The original dark-purple theme',
      '--bg': '#0b0a14', '--bg2': '#12111f', '--bg3': '#1a192b', '--bg4': '#22203a', '--bg5': '#2a2840',
      '--card': '#161526', '--border': 'rgba(255,255,255,0.07)', '--border2': 'rgba(255,255,255,0.13)', '--border3': 'rgba(255,255,255,0.22)',
      '--text': '#dddaf0', '--text2': '#9a98b5', '--text3': '#5a587a',
      '--gold': '#e8c547', '--gold2': '#f5d76e', '--gold3': '#a88a20',
      '--purple': '#7c5cbf', '--purple2': '#9b7ee0', '--purple3': '#c4aaff',
      '--teal': '#2cb67d', '--teal2': '#3de09a',
      '--coral': '#e85d4a', '--coral2': '#ff7b6b',
      '--blue': '#4a9eff', '--pink': '#d4549a', '--amber': '#f5a623', '--green': '#3ecf8e', '--red': '#ff4d4d'
    },
    midnight: {
      label: 'Midnight',
      desc: 'Deep navy with indigo accents',
      '--bg': '#080c14', '--bg2': '#0e1220', '--bg3': '#141a2c', '--bg4': '#1c2438', '--bg5': '#242e46',
      '--card': '#0e1220', '--border': 'rgba(99,132,255,0.09)', '--border2': 'rgba(99,132,255,0.16)', '--border3': 'rgba(99,132,255,0.26)',
      '--text': '#e4eaf8', '--text2': '#8899cc', '--text3': '#3d4d78',
      '--gold': '#f0c060', '--gold2': '#f8d880', '--gold3': '#a07820',
      '--purple': '#6366f1', '--purple2': '#818cf8', '--purple3': '#c7d2fe',
      '--teal': '#06b6d4', '--teal2': '#22d3ee',
      '--coral': '#f43f5e', '--coral2': '#fb7185',
      '--blue': '#60a5fa', '--pink': '#e879f9', '--amber': '#fbbf24', '--green': '#34d399', '--red': '#f87171'
    },
    forest: {
      label: 'Forest',
      desc: 'Rich emerald & golden moss',
      '--bg': '#080f0a', '--bg2': '#0e1a10', '--bg3': '#142318', '--bg4': '#1b2e20', '--bg5': '#223929',
      '--card': '#0e1a10', '--border': 'rgba(80,200,120,0.09)', '--border2': 'rgba(80,200,120,0.15)', '--border3': 'rgba(80,200,120,0.24)',
      '--text': '#d8f0d0', '--text2': '#7ab888', '--text3': '#3a6644',
      '--gold': '#d4a840', '--gold2': '#e8c060', '--gold3': '#8a6818',
      '--purple': '#8b7cc8', '--purple2': '#a898e0', '--purple3': '#ccc4f8',
      '--teal': '#2ecc80', '--teal2': '#48e8a0',
      '--coral': '#e06040', '--coral2': '#f08060',
      '--blue': '#5ab0e8', '--pink': '#d478b8', '--amber': '#d4a030', '--green': '#40d890', '--red': '#e04848'
    },
    paper: {
      label: 'Parchment',
      desc: 'Soft warm cream — easy on the eyes in daylight',
      '--bg': '#f7f3eb', '--bg2': '#ffffff', '--bg3': '#eee8dc', '--bg4': '#e4ddd0', '--bg5': '#d9d0c2',
      '--card': '#ffffff', '--border': 'rgba(160,120,60,0.12)', '--border2': 'rgba(160,120,60,0.22)', '--border3': 'rgba(160,120,60,0.35)',
      '--text': '#211c14', '--text2': '#7a6a52', '--text3': '#b8a888',
      '--gold': '#b06a00', '--gold2': '#d08820', '--gold3': '#7a4800',
      '--purple': '#6040b8', '--purple2': '#8060d8', '--purple3': '#3a2888',
      '--teal': '#1a7860', '--teal2': '#22a07a',
      '--coral': '#c82c18', '--coral2': '#e04830',
      '--blue': '#1a58b0', '--pink': '#b02878', '--amber': '#b86000', '--green': '#1e7840', '--red': '#b81818'
    }
  },

  getCustomThemes(scope = 'global') {
    const key = scope === 'quote' ? 'qv_custom_themes' : scope === 'date' ? 'dv_custom_themes' : 'vt_custom_themes';
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (error) {
      return {};
    }
  },

  saveCustomThemes(obj, scope = 'global') {
    const key = scope === 'quote' ? 'qv_custom_themes' : scope === 'date' ? 'dv_custom_themes' : 'vt_custom_themes';
    localStorage.setItem(key, JSON.stringify(obj));
  },

  getAllThemes(scope = 'global') {
    return { ...this.defaultThemes, ...this.getCustomThemes(scope) };
  },

  applyTheme(key, scope = 'global') {
    const all = this.getAllThemes(scope);
    const theme = all[key] || this.defaultThemes.default;
    const root = document.documentElement.style;
    Object.entries(theme).forEach(([k, v]) => {
      if (k.startsWith('--')) root.setProperty(k, v);
    });

    localStorage.setItem('vt_theme', key);
    VaultUser.saveProfile({ theme: key });

    const userKey = VaultUser.getKey();
    if (userKey) {
      fetch(`${this.WORKER_URL}/lb/update-theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, theme: key })
      }).catch(() => {});
    }
  },

  initTheme(scope = 'global') {
    const fallbackTheme = window.S && window.S.settings && window.S.settings.theme ? window.S.settings.theme : 'default';
    const key = localStorage.getItem('vt_theme') || fallbackTheme || 'default';
    const theme = this.getAllThemes(scope)[key] || this.defaultThemes.default;
    const root = document.documentElement.style;
    Object.entries(theme).forEach(([k, v]) => {
      if (k.startsWith('--')) root.setProperty(k, v);
    });

    if (window.S && window.S.settings) {
      window.S.settings.theme = key;
    }
  },

  _varToHex(value) {
    if (!value) return '#000000';
    if (value.startsWith('#')) return value.slice(0, 7);
    const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return '#' + [match[1], match[2], match[3]].map((part) => parseInt(part, 10).toString(16).padStart(2, '0')).join('');
    }
    return '#888888';
  },

  _varToAlpha(value) {
    if (!value) return 1;
    const match = value.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
    return match ? parseFloat(match[1]) : 1;
  },

  _buildRgba(hexVal, alphaVal) {
    const r = parseInt(hexVal.slice(1, 3), 16);
    const g = parseInt(hexVal.slice(3, 5), 16);
    const b = parseInt(hexVal.slice(5, 7), 16);
    if (alphaVal >= 1) return hexVal;
    return `rgba(${r}, ${g}, ${b}, ${alphaVal})`;
  },

  _tcReadAll() {
    const result = {};
    this.THEME_VAR_GROUPS.forEach(({ group, vars }) => {
      const isBorder = group === 'Borders';
      vars.forEach(([, variable]) => {
        const input = document.getElementById(`tc-${variable.replace(/-/g, '_')}`);
        if (!input) return;
        if (isBorder) {
          const alphaInput = document.getElementById(`tca-${variable.replace(/-/g, '_')}`);
          const alpha = alphaInput ? parseFloat(alphaInput.value) : 1;
          result[variable] = this._buildRgba(input.value, alpha);
        } else {
          result[variable] = input.value;
        }
      });
    });
    return result;
  },

  tcLiveUpdate() {
    const data = this._tcReadAll();
    const root = document.documentElement.style;
    Object.entries(data).forEach(([key, value]) => root.setProperty(key, value));

    const preview = document.getElementById('tc-preview');
    if (preview) {
      const cols = [data['--bg2'], data['--bg3'], data['--card'], data['--purple'], data['--gold'], data['--teal'], data['--coral'], data['--blue']];
      preview.innerHTML = cols.map((color) => `<div style="flex:1;background:${color || '#333'}"></div>`).join('');
    }
  },

  tcImportFromCode() {
    const raw = (document.getElementById('tc-import-code')?.value || '').trim();
    try {
      const jsonStr = raw.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g, '$1"$2":').replace(/'/g, '"');
      const obj = JSON.parse(jsonStr);
      this.THEME_VAR_GROUPS.forEach(({ group, vars }) => {
        const isBorder = group === 'Borders';
        vars.forEach(([, variable]) => {
          if (obj[variable] === undefined) return;
          const input = document.getElementById(`tc-${variable.replace(/-/g, '_')}`);
          if (input) input.value = this._varToHex(obj[variable]);
          if (isBorder) {
            const alphaInput = document.getElementById(`tca-${variable.replace(/-/g, '_')}`);
            if (alphaInput) alphaInput.value = this._varToAlpha(obj[variable]);
          }
        });
      });
      this.tcLiveUpdate();
      if (window.toast) window.toast('✅ Colours imported from code');
    } catch (error) {
      if (window.toast) window.toast('⚠️ Could not parse theme code');
    }
  },

  tcCopyAsCode() {
    const name = (document.getElementById('tc-name')?.value.trim() || 'My Theme');
    const desc = (document.getElementById('tc-desc')?.value.trim() || '');
    const values = this._tcReadAll();
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const lines = [`'${key}': {`, `  label: '${name.replace(/'/g, "\\'")}', desc: '${desc.replace(/'/g, "\\'")}',`];
    lines.push(`  '--bg': '${values['--bg']}', '--bg2': '${values['--bg2']}', '--bg3': '${values['--bg3']}', '--bg4': '${values['--bg4']}', '--bg5': '${values['--bg5']}',`);
    lines.push(`  '--card': '${values['--card']}', '--border': '${values['--border']}', '--border2': '${values['--border2']}', '--border3': '${values['--border3']}',`);
    lines.push(`  '--text': '${values['--text']}', '--text2': '${values['--text2']}', '--text3': '${values['--text3']}',`);
    lines.push(`  '--gold': '${values['--gold']}', '--gold2': '${values['--gold2']}', '--gold3': '${values['--gold3']}',`);
    lines.push(`  '--purple': '${values['--purple']}', '--purple2': '${values['--purple2']}', '--purple3': '${values['--purple3']}',`);
    lines.push(`  '--teal': '${values['--teal']}', '--teal2': '${values['--teal2']}',`);
    lines.push(`  '--coral': '${values['--coral']}', '--coral2': '${values['--coral2']}',`);
    lines.push(`  '--blue': '${values['--blue']}', '--pink': '${values['--pink']}', '--amber': '${values['--amber']}', '--green': '${values['--green']}', '--red': '${values['--red']}',`);
    lines.push('},');

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      if (window.toast) window.toast('📋 Copied as code!');
    }).catch(() => {
      if (window.toast) window.toast('Copy failed');
    });
  },

  saveCustomTheme(editKey, scope = 'global') {
    const name = (document.getElementById('tc-name')?.value.trim() || 'My Theme');
    const desc = (document.getElementById('tc-desc')?.value.trim() || '');
    const key = editKey || `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const base = this.getAllThemes(scope)[editKey] || this.defaultThemes.default;
    const theme = { ...base, ...this._tcReadAll(), label: name, desc };
    const customThemes = this.getCustomThemes(scope);
    customThemes[key] = theme;
    this.saveCustomThemes(customThemes, scope);
    this.syncCustomThemeToWorker(key, theme);
    if (typeof closeModal === 'function') closeModal();
    this.applyTheme(key, scope);
    if (typeof render === 'function') render();
    if (window.toast) window.toast('🎨 Theme saved & applied!');
  },

  async syncCustomThemeToWorker(key, theme) {
    const userKey = VaultUser.getKey();
    if (!userKey) return;
    try {
      await fetch(`${this.WORKER_URL}/themes/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, key, theme })
      });
    } catch (error) {
      console.warn('Theme sync failed:', error);
    }
  },

  async loadServerCustomThemes(scope = 'global') {
    const userKey = VaultUser.getKey();
    if (!userKey) return;
    try {
      const response = await fetch(`${this.WORKER_URL}/themes/list?userKey=${encodeURIComponent(userKey)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.themes && typeof data.themes === 'object') {
        this.saveCustomThemes(data.themes, scope);
        const activeKey = localStorage.getItem('vt_theme') || (window.S && window.S.settings && window.S.settings.theme) || 'default';
        const allNow = this.getAllThemes(scope);
        this.applyTheme(allNow[activeKey] ? activeKey : 'default', scope);
        if (typeof render === 'function') render();
      }
    } catch (error) {
      console.warn('Theme load failed:', error);
    }
  },

  deleteCustomTheme(key, scope = 'global') {
    if (!confirm('Delete this custom theme?')) return;
    const customThemes = this.getCustomThemes(scope);
    delete customThemes[key];
    this.saveCustomThemes(customThemes, scope);
    if (window.S && window.S.settings && window.S.settings.theme === key) {
      this.applyTheme('default', scope);
    }

    const userKey = VaultUser.getKey();
    if (userKey) {
      fetch(`${this.WORKER_URL}/themes/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, key })
      }).catch(() => {});
    }

    if (typeof closeModal === 'function') closeModal();
    if (typeof render === 'function') render();
    if (window.toast) window.toast('Theme deleted');
  },

  openThemeBuilder(editKey, scope = 'global') {
    const all = this.getAllThemes(scope);
    const base = editKey ? all[editKey] : this.defaultThemes.default;
    const isNew = !editKey || !this.getCustomThemes(scope)[editKey];
    const title = isNew ? 'Create Custom Theme' : 'Edit Theme';
    const groupHtml = this.THEME_VAR_GROUPS.map(({ group, vars }) => {
      const isBorder = group === 'Borders';
      const rows = vars.map(([label, variable]) => {
        const raw = base[variable] || '#000000';
        const hexValue = this._varToHex(raw);
        const alphaValue = this._varToAlpha(raw);
        const alphaRow = isBorder ? `<input type="range" min="0" max="1" step="0.01" id="tca-${variable.replace(/-/g, '_')}" value="${alphaValue}" oninput="ThemeManager.tcLiveUpdate()" style="width:70px;accent-color:var(--purple)">` : '';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);gap:6px">
          <span style="font-size:.75rem;color:var(--text2);flex:1;min-width:0">${label}</span>
          <div style="display:flex;align-items:center;gap:6px">
            ${alphaRow}
            <input type="color" id="tc-${variable.replace(/-/g, '_')}" value="${hexValue}" oninput="ThemeManager.tcLiveUpdate()" style="width:36px;height:26px;border:none;border-radius:5px;cursor:pointer;background:none;padding:0;flex-shrink:0">
          </div>
        </div>`;
      }).join('');

      return `<div style="margin-bottom:10px">
        <div style="font-size:.62rem;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:2px;padding-top:2px">${group}</div>
        ${rows}
      </div>`;
    }).join('');

    if (typeof openModal === 'function') {
      openModal(`<div>
        <div style="font-family:'Playfair Display',serif;font-size:1rem;color:var(--gold);margin-bottom:10px">🎨 ${title}</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <div class="fg" style="flex:1;min-width:140px;margin-bottom:0"><label>Theme name</label>
            <input type="text" id="tc-name" placeholder="My theme" value="${editKey && !isNew ? all[editKey].label || editKey : ''}">
          </div>
          <div class="fg" style="flex:2;min-width:180px;margin-bottom:0"><label>Description (optional)</label>
            <input type="text" id="tc-desc" placeholder="A short description" value="${editKey ? all[editKey].desc || '' : ''}">
          </div>
        </div>
        <div id="tc-preview" style="border-radius:8px;overflow:hidden;border:1px solid var(--border2);margin-bottom:10px;height:42px;display:flex;align-items:stretch"></div>
        <details style="margin-bottom:8px">
          <summary style="font-size:.72rem;color:var(--text3);cursor:pointer;user-select:none;padding:4px 0">📋 Import from code (paste a theme object)</summary>
          <div style="margin-top:6px">
            <textarea id="tc-import-code" rows="4" placeholder="Paste a THEMES object value here e.g. { '--bg':'#0b0a14', ... }" style="font-family:'DM Mono',monospace;font-size:.7rem"></textarea>
            <button class="btn bsm" style="margin-top:4px" onclick="ThemeManager.tcImportFromCode()">⬆ Apply to pickers</button>
          </div>
        </details>
        <div style="font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">All colours
          <span style="color:var(--text3);font-size:.6rem;text-transform:none;letter-spacing:0;margin-left:4px">(border alpha = slider, colour = swatch)</span>
        </div>
        <div style="max-height:340px;overflow-y:auto;padding-right:4px">${groupHtml}</div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn bp" onclick="ThemeManager.saveCustomTheme('${editKey || ''}', '${scope}')">💾 Save & Apply</button>
          <button class="btn" style="color:var(--teal2);border-color:var(--teal)" onclick="ThemeManager.tcCopyAsCode()">📋 Copy as code</button>
          ${editKey && !isNew ? `<button class="btn br" onclick="ThemeManager.deleteCustomTheme('${editKey}', '${scope}')">🗑 Delete</button>` : ''}
          <button class="btn" onclick="ThemeManager.tcCancelPreview('${editKey || ''}', '${scope}')">Cancel</button>
        </div>
      </div>`);
    }

    this.tcLiveUpdate();
  },

  tcCancelPreview() {
    const key = localStorage.getItem('vt_theme') || 'default';
    this.applyTheme(key);
    if (typeof closeModal === 'function') closeModal();
  }
};

// --- 9. FEEDBACK AND ADMIN API HELPERS ---
const WORKER_API = VaultUser.WORKER_URL;

function sanitizeText(value) {
  return String(value || '').replace(/[<>]/g, '').trim();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

function getAdminToken() {
  return localStorage.getItem('gcse_vault_admin_token') || null;
}

function hasAdminSession() {
  return Boolean(getAdminToken());
}

async function apiRequest(path, options = {}) {
  const token = getAdminToken();
  const url = new URL(path, `${WORKER_API}/`);
  if (token) url.searchParams.set('token', token);

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : data.error || `Request failed (${response.status})`);
  }
  return data;
}

function getSavedUserProfile() {
  return VaultUser.getProfile();
}

const AdminManager = {
  token: null,
  items: [],
  loading: false,
  error: '',

  getToken() {
    return this.token || getAdminToken();
  },

  async login(password) {
    try {
      const response = await fetch(`${WORKER_API}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pw: password })
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Incorrect password' : `HTTP ${response.status}`);
      const data = await response.json();
      this.token = data.token;
      localStorage.setItem('gcse_vault_admin_token', data.token);
      this.error = '';
      await this.refresh();
    } catch (error) {
      this.error = error.message;
      if (typeof window.render === 'function') window.render();
    }
  },

  logout() {
    this.token = null;
    this.items = [];
    localStorage.removeItem('gcse_vault_admin_token');
    if (typeof window.render === 'function') window.render();
  },

  async request(path) {
    const token = this.getToken();
    const response = await fetch(`${WORKER_API}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  async refresh() {
    if (!this.getToken()) return;
    this.loading = true;
    this.error = '';
    if (typeof window.render === 'function') window.render();
    try {
      const [quotes, dates, feedback] = await Promise.all([
        this.request('/pending'),
        this.request('/dv/pending'),
        this.request('/feedback/list')
      ]);
      this.items = [
        ...(quotes.items || []).map((item) => ({ ...item, _source: 'QuoteVault', _kind: 'quote' })),
        ...(dates.items || []).map((item) => ({ ...item, _source: 'DateVault', _kind: 'date' })),
        ...(feedback.items || []).map((item) => ({ ...item, _source: 'Feedback', _kind: 'feedback' }))
      ].sort((a, b) => String(b.submittedAt || b.timestamp || '').localeCompare(String(a.submittedAt || a.timestamp || '')));
    } catch (error) {
      this.error = error.message;
    } finally {
      this.loading = false;
      if (typeof window.render === 'function') window.render();
    }
  },

  async action(index, action) {
    const item = this.items[index];
    if (!item) return;
    const routes = {
      quote: { approve: '/approve', reject: '/reject' },
      date: { approve: '/dv/approve', reject: '/dv/reject' },
      feedback: { delete: '/feedback/delete' }
    };
    const path = routes[item._kind]?.[action];
    if (!path) return;
    try {
      const response = await fetch(`${WORKER_API}${path}?token=${encodeURIComponent(this.getToken())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, token: this.getToken() })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.refresh();
    } catch (error) {
      this.error = error.message;
      if (typeof window.render === 'function') window.render();
    }
  },

  render() {
    const token = this.getToken();
    if (!token) {
      return `<div>${typeof backBtn === 'function' ? backBtn() : ''}
        <div class="pt">Admin Panel</div>
        <div class="ps">One shared review queue for QuoteVault, DateVault, and Feedback</div>
        <div class="card" style="max-width:360px">
          <div class="fg"><label>Password</label><input type="password" id="shared-admin-password" placeholder="Enter admin password"></div>
          <button class="btn bg" onclick="AdminManager.login(document.getElementById('shared-admin-password').value)">🔐 Login</button>
          ${this.error ? `<div class="qfb qwr" style="margin-top:8px">${UI.escapeHTML(this.error)}</div>` : ''}
        </div>
      </div>`;
    }

    const counts = this.items.reduce((result, item) => {
      result[item._kind] = (result[item._kind] || 0) + 1;
      return result;
    }, {});
    const cards = this.items.map((item, index) => {
      const title = item._kind === 'quote' ? item.text : item._kind === 'date' ? item.event : item.title;
      const detail = item._kind === 'quote'
        ? `${item.char || ''} · ${item.work || ''} · ${item.loc || ''}`
        : item._kind === 'date' ? `${item.year || ''} · ${item.topic || ''}` : item.description;
      const controls = item._kind === 'feedback'
        ? `<button class="btn bsm br" onclick="AdminManager.action(${index}, 'delete')">🗑 Delete</button>`
        : `<button class="btn bsm" onclick="AdminManager.action(${index}, 'approve')">✅ Approve</button>
          <button class="btn bsm br" onclick="AdminManager.action(${index}, 'reject')">❌ Reject</button>`;
      return `<div class="card" style="margin-bottom:8px;border-left:3px solid var(--amber)">
        <div class="tag tg">${UI.escapeHTML(item._source)}</div>
        <div style="font-weight:600;margin-top:5px">${UI.escapeHTML(title || 'Untitled')}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:4px">${UI.escapeHTML(detail || '')}</div>
        <div style="font-size:.62rem;color:var(--text3);margin-top:5px">${UI.escapeHTML(item.submittedAt || item.timestamp || '')}</div>
        <div style="display:flex;gap:6px;margin-top:8px">${controls}</div>
      </div>`;
    }).join('');

    return `<div>${typeof backBtn === 'function' ? backBtn() : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div><div class="pt">Admin Panel</div><div class="ps">All sites and feedback in one queue</div></div>
        <div style="display:flex;gap:6px"><button class="btn bsm" onclick="AdminManager.refresh()">🔄 Refresh</button><button class="btn bsm" onclick="AdminManager.logout()">🔒 Logout</button></div>
      </div>
      ${this.error ? `<div class="qfb qwr">${UI.escapeHTML(this.error)}</div>` : ''}
      <div class="g3" style="margin:10px 0 12px">
        <div class="scard"><div class="snum">${counts.quote || 0}</div><div class="slbl">QuoteVault</div></div>
        <div class="scard"><div class="snum">${counts.date || 0}</div><div class="slbl">DateVault</div></div>
        <div class="scard"><div class="snum">${counts.feedback || 0}</div><div class="slbl">Feedback</div></div>
      </div>
      ${this.loading ? '<div class="ps">Loading shared submissions...</div>' : cards || '<div class="ps">No submissions waiting for review.</div>'}
    </div>`;
  }
};

// --- AUTOMATIC INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  Settings.init();
  UI.initMobileMenu();
  VaultUser.clearStaleLegacyKeys();
});