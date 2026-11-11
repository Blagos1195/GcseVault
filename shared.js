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

  async readResponse(response) {
    const raw = await response.text();
    try { return JSON.parse(raw); } catch { return { error: raw || `HTTP ${response.status}` }; }
  },

  getAccountSession() {
    return localStorage.getItem('vault_account_session') || null;
  },

  setAccountSession(value) {
    if (!value) return null;
    localStorage.setItem('vault_account_session', value);
    return value;
  },

  async validateAccountSession() {
    const token = this.getAccountSession();
    if (!token) return false;
    const response = await fetch(`${this.WORKER_URL}/account/session`, {
      headers: { 'X-Account-Session': token }
    });
    if (response.status === 401) {
      if (this.getAccountSession() === token) {
        if (typeof window !== 'undefined' && typeof window.prepareRevisionAccountLogout === 'function') window.prepareRevisionAccountLogout();
        localStorage.removeItem('vault_account_session');
        if (typeof window !== 'undefined' && typeof window.finishRevisionAccountLogout === 'function') window.finishRevisionAccountLogout();
        if (typeof window !== 'undefined' && typeof window.syncReviewSchedules === 'function') await window.syncReviewSchedules();
      }
      return false;
    }
    const data = await this.readResponse(response);
    if (!response.ok) throw new Error(data.error || data.message || 'Could not verify your account session.');
    if (this.getAccountSession() !== token) return false;
    if (data.username) this.setUsername(data.username);
    return true;
  },

  async createPasswordCredentials(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new Error('Use a password between 12 and 128 characters.');
    }
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const passwordSalt = btoa(String.fromCharCode(...saltBytes));
    const passwordHash = await this.derivePasswordHash(password, passwordSalt);
    return { passwordSalt, passwordHash };
  },

  async derivePasswordHash(password, passwordSalt) {
    const saltBytes = Uint8Array.from(atob(passwordSalt), character => character.charCodeAt(0));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 600000 },
      material,
      256
    );
    return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
  },

  async setupPassword(password) {
    const userKey = this.getKey();
    if (!userKey) throw new Error('Link your existing account first.');
    const credentials = await this.createPasswordCredentials(password);
    const response = await fetch(`${this.WORKER_URL}/account/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey, ...credentials })
    });
    const data = await this.readResponse(response);
    if (!response.ok) throw new Error(data.error || data.message || 'Could not set password.');
    this.setAccountSession(data.token);
    this.setUsername(data.username);
    return data;
  },

  async login(username, password) {
    if (typeof window !== 'undefined' && typeof window.prepareRevisionAccountSwitch === 'function') window.prepareRevisionAccountSwitch();
    if (typeof window !== 'undefined' && typeof window.syncReviewSchedules === 'function') await window.syncReviewSchedules();
    const challengeResponse = await fetch(`${this.WORKER_URL}/account/challenge?username=${encodeURIComponent(username)}`);
    const challenge = await this.readResponse(challengeResponse);
    if (!challengeResponse.ok) throw new Error('Invalid username or password.');
    const passwordHash = await this.derivePasswordHash(password, challenge.passwordSalt);
    const response = await fetch(`${this.WORKER_URL}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, passwordHash })
    });
    const data = await this.readResponse(response);
    if (!response.ok) throw new Error(data.error || data.message || 'Invalid username or password.');
    this.setAccountSession(data.token);
    this.setKey(data.userKey);
    this.setUsername(data.username);
    if (typeof window !== 'undefined' && typeof window.activateRevisionAccount === 'function') window.activateRevisionAccount(data.userKey);
    if (typeof window !== 'undefined' && typeof window.syncReviewSchedules === 'function') await window.syncReviewSchedules();
    return data;
  },

  async resetPassword(password) {
    const userKey = this.getKey();
    if (!userKey) throw new Error('Link your account key before resetting the password.');
    const credentials = await this.createPasswordCredentials(password);
    const response = await fetch(`${this.WORKER_URL}/account/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey, ...credentials })
    });
    const data = await this.readResponse(response);
    if (!response.ok) throw new Error(data.error || data.message || 'Could not reset password.');
    this.setAccountSession(data.token);
    this.setUsername(data.username);
    return data;
  },

  async logoutAccount() {
    const token = this.getAccountSession();
    if (token && typeof window !== 'undefined' && typeof window.prepareRevisionAccountLogout === 'function') window.prepareRevisionAccountLogout();
    if (token && typeof window !== 'undefined' && typeof window.syncReviewSchedules === 'function') await window.syncReviewSchedules();
    if (token) {
      const response = await fetch(`${this.WORKER_URL}/account/logout`, {
        method: 'POST',
        headers: { 'X-Account-Session': token }
      });
      if (response.status !== 401) {
        const data = await this.readResponse(response);
        if (!response.ok) throw new Error(data.error || data.message || 'Could not sign out. Please try again.');
      }
    }
    if (!token || this.getAccountSession() === token) localStorage.removeItem('vault_account_session');
    if (token && typeof window !== 'undefined' && typeof window.finishRevisionAccountLogout === 'function') window.finishRevisionAccountLogout();
    if (token && typeof window !== 'undefined' && typeof window.syncReviewSchedules === 'function') await window.syncReviewSchedules();
  },

  showAccountDialog() {
    if (typeof window.openModal !== 'function') return;
    const linked = !!this.getKey();
    let mode = 'login';
    const usernameValue = () => UI.escapeHTML(this.getUsername() || '');
    const refresh = async () => {
      const token = this.getAccountSession();
      if (token) {
        try {
          if (await this.validateAccountSession() && this.getAccountSession() === token) {
            window.openModal(`<div>
              <div style="font-family:'Playfair Display',serif;font-size:1rem;color:var(--gold);margin-bottom:6px">GCSE Vault account</div>
              <div style="font-size:.8rem;color:var(--text2);margin-bottom:14px">Signed in as <strong style="color:var(--gold)">${usernameValue()}</strong></div>
              <button class="btn" id="vault-account-logout">Sign out</button>
              <button class="btn" onclick="closeModal()">Close</button>
            </div>`);
            document.getElementById('vault-account-logout').onclick = async () => {
              const button = document.getElementById('vault-account-logout');
              button.disabled = true;
              try {
                await this.logoutAccount();
                window.closeModal();
                if (typeof window.render === 'function') window.render();
                if (typeof window.renderRevision === 'function') window.renderRevision();
              } catch (error) {
                button.disabled = false;
                const message = document.createElement('div');
                message.style.cssText = 'font-size:.72rem;margin:8px 0;color:var(--coral)';
                message.textContent = error.message;
                button.before(message);
              }
            };
            return;
          }
        } catch (error) {
          console.warn('Account session verification failed:', error);
        }
      }
      const titles = { login: 'Sign in', create: 'Create account', setup: 'Set password', reset: 'Reset password' };
      const descriptions = {
        login: 'Use your GCSE Vault username and password to sync progress, join leaderboards and submit work for publication.',
        create: 'Create one account for QuoteVault, DateVault and Revision. Personal study cards remain free without an account.',
        setup: 'Your existing account is linked on this device. Set a password to use it across all three sites.',
        reset: 'Choose a new password for your existing account.'
      };
      const isSetup = mode === 'setup' || mode === 'reset';
      window.openModal(`<div>
        <div style="font-family:'Playfair Display',serif;font-size:1rem;color:var(--gold);margin-bottom:6px">GCSE Vault account</div>
        <div style="font-size:.75rem;color:var(--text2);margin-bottom:12px">${descriptions[mode]}</div>
        <div class="fg">
          <label for="vault-account-username">Username</label>
          <input id="vault-account-username" autocomplete="username" value="${usernameValue()}" ${isSetup?'readonly':''}>
        </div>
        <div class="fg">
          <label for="vault-account-password">${mode === 'login' ? 'Password' : 'New password'}</label>
          <input id="vault-account-password" type="password" autocomplete="${mode === 'login'?'current-password':'new-password'}" minlength="12">
        </div>
        <div style="font-size:.7rem;color:var(--text3);margin:-4px 0 10px">${mode === 'login'?'':'Use at least 12 characters.'}</div>
        <div id="vault-account-error" style="font-size:.72rem;margin:8px 0;color:var(--coral)"></div>
        <button class="btn bg" id="vault-account-submit">${titles[mode]}</button>
        ${mode === 'login' ? '<button class="btn" id="vault-account-toggle">Create an account</button>' : mode === 'create' ? '<button class="btn" id="vault-account-toggle">Already have an account? Sign in</button>' : ''}
        ${!linked && (mode === 'login' || mode === 'create') ? '<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--text3);font-size:.72rem">Have an older account? Recover it with your user key</summary><div class="fg" style="margin-top:9px"><label for="vault-account-old-key">Existing user key</label><input id="vault-account-old-key" autocomplete="off" placeholder="Paste your old user key"></div><button class="btn" id="vault-account-recover">Recover existing account</button></details>' : ''}
        <button class="btn" onclick="closeModal()">Cancel</button>
      </div>`);
      const username = document.getElementById('vault-account-username');
      const password = document.getElementById('vault-account-password');
      const error = document.getElementById('vault-account-error');
      const finish = async () => {
        window.closeModal();
        if (typeof window.activateRevisionAccount === 'function' && this.getAccountSession()) window.activateRevisionAccount(this.getKey());
        if (typeof window !== 'undefined' && typeof window.syncReviewSchedules === 'function') await window.syncReviewSchedules();
        if (typeof window.syncFromWorker === 'function') await window.syncFromWorker();
        if (typeof window.loadRevision === 'function') await window.loadRevision();
        if (typeof window.syncRevisionTheme === 'function') await window.syncRevisionTheme();
        if (typeof window.render === 'function') window.render();
        if (typeof window.renderRevision === 'function') window.renderRevision();
      };
      const submit = document.getElementById('vault-account-submit');
      submit.onclick = async () => {
        const name = username.value.trim();
        try {
          if (password.value.length < 12) throw new Error('Use a password of at least 12 characters.');
          submit.disabled = true;
          if (mode === 'login') {
            await this.login(name, password.value);
          } else if (mode === 'create') {
            if (!/^[a-zA-Z0-9_-]{3,20}$/.test(name)) throw new Error('Choose a username of 3–20 letters, numbers, _ or -.');
            const response = await fetch(`${this.WORKER_URL}/lb/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: name, site: 'qv', mastered: 0, xp: 0, mastered_ids: [], pending_ids: [], pending_data: [] })
            });
            const account = await this.readResponse(response);
            if (!response.ok || !account.userKey) throw new Error(account.error || 'Could not create account.');
            this.setKey(account.userKey);
            this.setUsername(account.user?.username || name);
            mode = 'setup';
            await this.setupPassword(password.value);
          } else if (mode === 'setup') {
            await this.setupPassword(password.value);
          } else {
            await this.resetPassword(password.value);
          }
          await finish();
        } catch (e) {
          if (mode === 'setup' && this.getKey() && !this.getAccountSession()) {
            refresh();
            document.getElementById('vault-account-error').textContent = e.message;
          } else {
            error.textContent = e.message;
            submit.disabled = false;
          }
        }
      };
      const toggle = document.getElementById('vault-account-toggle');
      if (toggle) toggle.onclick = () => {
        mode = mode === 'create' ? 'login' : 'create';
        refresh();
      };
      const recover = document.getElementById('vault-account-recover');
      if (recover) recover.onclick = async () => {
        const key = document.getElementById('vault-account-old-key').value.trim();
        try {
          if (key.length < 10) throw new Error('Enter the user key from your old account.');
          recover.disabled = true;
          const response = await fetch(`${this.WORKER_URL}/lb/get?userKey=${encodeURIComponent(key)}`);
          const account = await this.readResponse(response);
          if (!response.ok || !account.found || !account.user) throw new Error('That user key was not found.');
          this.setKey(key);
          this.setUsername(account.user.username);
          const challenge = await fetch(`${this.WORKER_URL}/account/challenge?username=${encodeURIComponent(account.user.username)}`);
          mode = challenge.ok ? 'reset' : 'setup';
          refresh();
        } catch (e) {
          error.textContent = e.message;
          recover.disabled = false;
        }
      };
    };
    refresh();
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

if (!window.__vaultAccountFetchWrapped) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const requestUrl = typeof input === 'string' ? input : input.url;
    if (requestUrl && requestUrl.startsWith(VaultUser.WORKER_URL)) {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      const token = VaultUser.getAccountSession();
      if (token) headers.set('X-Account-Session', token);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
  window.__vaultAccountFetchWrapped = true;
}

if (VaultUser.getAccountSession()) {
  VaultUser.validateAccountSession().then(valid => {
    if (!valid) {
      if (typeof window.render === 'function') window.render();
      if (typeof window.renderRevision === 'function') window.renderRevision();
    }
  }).catch(error => console.warn('Account session verification failed:', error));
}

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
    },
    'barker-orange': {
      label: 'Barker Orange',
      desc: 'For those who know 💀',
      '--bg': '#ff9500', '--bg2': '#ff0000', '--bg3': '#ff9f0a', '--bg4': '#ffa712', '--bg5': '#ffaf1a',
      '--card': '#c800ff', '--border': 'rgba(255,255,255,0.07)', '--border2': 'rgba(255,255,255,0.13)', '--border3': 'rgba(255,255,255,0.22)',
      '--text': '#000000', '--text2': '#242334', '--text3': '#060516',
      '--gold': '#00ff11', '--gold2': '#0fff20', '--gold3': '#00eb00',
      '--purple': '#05ffd5', '--purple2': '#00eeff', '--purple3': '#c4aaff',
      '--teal': '#2cb67d', '--teal2': '#3ec88f',
      '--coral': '#e85d4a', '--coral2': '#f76c59',
      '--blue': '#ff00c8', '--pink': '#d4549a', '--amber': '#f5a623', '--green': '#3ecf8e', '--red': '#ff4d4d'
    },
    'bricked-device': {
      label: 'Bricked Device',
      desc: 'Good luck 💀',
      '--bg': '#000000', '--bg2': '#000000', '--bg3': '#000000', '--bg4': '#000000', '--bg5': '#000000',
      '--card': '#000000', '--border': 'rgba(0,0,0,0)', '--border2': 'rgba(0,0,0,0)', '--border3': 'rgba(0,0,0,0)',
      '--text': '#000000', '--text2': '#000000', '--text3': '#000000',
      '--gold': '#000000', '--gold2': '#000000', '--gold3': '#000000',
      '--purple': '#000000', '--purple2': '#000000', '--purple3': '#000000',
      '--teal': '#000000', '--teal2': '#000000',
      '--coral': '#000000', '--coral2': '#000000',
      '--blue': '#000000', '--pink': '#000000', '--amber': '#000000', '--green': '#000000', '--red': '#000000'
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

  async applyTheme(key, scope = 'global', sync = true) {
    const all = this.getAllThemes(scope);
    if (!all[key]) key = 'default';
    const theme = all[key] || this.defaultThemes.default;
    const root = document.documentElement.style;
    Object.entries(theme).forEach(([k, v]) => {
      if (k.startsWith('--')) root.setProperty(k, v);
    });
    localStorage.setItem('vt_theme', key);
    VaultUser.saveProfile({ theme: key });
    const userKey = VaultUser.getKey();
    if (!sync || !userKey || !VaultUser.getAccountSession()) return { synced: false };
    try {
      const response = await fetch(`${this.WORKER_URL}/lb/update-theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, theme: key })
      });
      const data = await VaultUser.readResponse(response);
      if (!response.ok || data.success === false) {
        throw new Error(data.error || data.message || `Theme sync failed (HTTP ${response.status}).`);
      }
      return { synced: true };
    } catch (error) {
      console.warn('Theme sync failed:', error);
      return { synced: false, error };
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

  async saveCustomTheme(editKey, scope = 'global') {
    const name = (document.getElementById('tc-name')?.value.trim() || 'My Theme');
    const desc = (document.getElementById('tc-desc')?.value.trim() || '');
    const key = editKey || `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const base = this.getAllThemes(scope)[editKey] || this.defaultThemes.default;
    const theme = { ...base, ...this._tcReadAll(), label: name, desc };
    const customThemes = this.getCustomThemes(scope);
    customThemes[key] = theme;
    this.saveCustomThemes(customThemes, scope);
    if (typeof closeModal === 'function') closeModal();
    const synced = await this.syncCustomThemeToWorker(key, theme);
    await this.applyTheme(key, scope, synced);
    if (typeof render === 'function') render();
    if (window.toast) window.toast(synced ? '🎨 Theme saved and synced!' : '🎨 Theme saved on this device. Sign in to sync it.');
  },

  async syncCustomThemeToWorker(key, theme) {
    const userKey = VaultUser.getKey();
    if (!userKey || !VaultUser.getAccountSession()) return false;
    try {
      const response = await fetch(`${this.WORKER_URL}/themes/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, key, theme })
      });
      if (!response.ok) {
        const data = await VaultUser.readResponse(response);
        throw new Error(data.error || data.message || `Theme upload failed (HTTP ${response.status}).`);
      }
      return true;
    } catch (error) {
      console.warn('Theme sync failed:', error);
      return false;
    }
  },

  async loadServerCustomThemes(scope = 'global') {
    const userKey = VaultUser.getKey();
    if (!userKey || !VaultUser.getAccountSession()) return { synced: false, error: new Error('Sign in to sync themes.') };
    try {
      const response = await fetch(`${this.WORKER_URL}/themes/list?userKey=${encodeURIComponent(userKey)}`);
      if (!response.ok) {
        const data = await VaultUser.readResponse(response);
        throw new Error(data.error || data.message || `Theme download failed (HTTP ${response.status}).`);
      }
      const data = await response.json();
      const remote = data.themes && typeof data.themes === 'object' ? data.themes : {};
      const merged = { ...remote };
      const uploads = [];
      const local = this.getCustomThemes(scope);
      for (const [key, theme] of Object.entries(local)) {
        if (!merged[key]) {
          merged[key] = theme;
          uploads.push([key, theme]);
        } else if (JSON.stringify(merged[key]) !== JSON.stringify(theme)) {
          let preservedKey = `${key}_local_${Date.now()}`;
          while (merged[preservedKey] || local[preservedKey]) preservedKey += '_copy';
          merged[preservedKey] = { ...theme, label: `${theme.label || key} (local copy)` };
          uploads.push([preservedKey, merged[preservedKey]]);
        }
      }
      this.saveCustomThemes(merged, scope);
      for (const [key, theme] of uploads) {
        if (!await this.syncCustomThemeToWorker(key, theme)) {
          return { synced: false, error: new Error(`Could not upload theme "${theme.label || key}".`) };
        }
      }
      if (typeof render === 'function') render();
      return { synced: true, count: Object.keys(merged).length, uploaded: uploads.length };
    } catch (error) {
      console.warn('Theme load failed:', error);
      return { synced: false, error };
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
  return sessionStorage.getItem('gcse_vault_admin_token') || null;
}

function hasAdminSession() {
  return Boolean(getAdminToken());
}

async function apiRequest(path, options = {}) {
  const token = getAdminToken();
  const url = new URL(path, `${WORKER_API}/`);
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Session-Token': token } : {}),
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
  role: null,
  username: null,
  items: [],
  users: [],
  loading: false,
  migrating: false,
  migrationStatus: '',
  statusChecked: false,
  statusChecking: false,
  ownerInitialized: true,
  error: '',

  getToken() {
    return this.token || getAdminToken();
  },

  async checkStatus() {
    if (this.statusChecked || this.statusChecking) return;
    this.statusChecking = true;
    try {
      const response = await fetch(`${WORKER_API}/admin/status`);
      if (!response.ok) throw new Error('Status check failed');
      const data = await response.json();
      this.ownerInitialized = Boolean(data.initialized);
    } catch {
      this.ownerInitialized = true;
    } finally {
      this.statusChecking = false;
      this.statusChecked = true;
      if (typeof window.render === 'function') window.render();
    }
  },

  async login() {
    const userKey = VaultUser.getKey();
    if (!userKey) {
      this.error = 'Link your GCSE Vault account before signing in.';
      if (typeof window.render === 'function') window.render();
      return;
    }
    try {
      const response = await fetch(`${WORKER_API}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Account-Session': VaultUser.getAccountSession() },
        body: JSON.stringify({ userKey })
      });
      if (!response.ok) throw new Error(response.status === 403 ? 'This account does not have admin access.' : `HTTP ${response.status}`);
      const data = await response.json();
      this.token = data.token;
      this.role = data.role;
      this.username = data.username;
      sessionStorage.setItem('gcse_vault_admin_token', data.token);
      this.error = '';
      await this.refresh();
    } catch (error) {
      this.error = error.message;
      if (typeof window.render === 'function') window.render();
    }
  },

  async bootstrap() {
    const userKey = VaultUser.getKey();
    const password = document.getElementById('admin-bootstrap-key')?.value || '';
    if (!userKey) {
      this.error = 'Link your GCSE Vault account before setting up the owner.';
      if (typeof window.render === 'function') window.render();
      return;
    }
    if (!password) {
      this.error = 'Enter the one-time setup key.';
      if (typeof window.render === 'function') window.render();
      return;
    }
    try {
      const response = await fetch(`${WORKER_API}/admin/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, pw: password })
      });
      if (!response.ok) throw new Error(response.status === 409 ? 'Owner setup has already been completed.' : `HTTP ${response.status}`);
      this.ownerInitialized = true;
      this.statusChecked = true;
      await this.login();
    } catch (error) {
      this.error = error.message;
      if (typeof window.render === 'function') window.render();
    }
  },

  async logout() {
    const token = this.getToken();
    if (token) {
      fetch(`${WORKER_API}/auth/logout`, {
        method: 'POST',
        headers: { 'X-Session-Token': token }
      }).catch(() => {});
    }
    this.token = null;
    this.role = null;
    this.username = null;
    this.items = [];
    this.users = [];
    sessionStorage.removeItem('gcse_vault_admin_token');
    localStorage.removeItem('gcse_vault_admin_token');
    if (typeof window.render === 'function') window.render();
  },

  async request(path) {
    const token = this.getToken();
    const response = await fetch(`${WORKER_API}${path}`, {
      headers: { 'X-Session-Token': token }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  async migrateStorage() {
    if (this.role !== 'owner' || this.migrating) return;
    this.migrating = true;
    this.migrationStatus = 'Preparing storage migration...';
    this.error = '';
    if (typeof window.render === 'function') window.render();
    try {
      let processedTotal = 0;
      let migratedTotal = 0;
      let alreadyPresentTotal = 0;
      let skippedTotal = 0;
      for (const phase of ['revision', 'revision-leaderboard', 'themes']) {
        let cursor = null;
        let processed = 0;
        let migrated = 0;
        let alreadyPresent = 0;
        let skipped = 0;
        do {
          const response = await fetch(`${WORKER_API}/admin/migrate-storage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.getToken() },
            body: JSON.stringify({ phase, cursor, limit: 100 })
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          const result = await response.json();
          processed += result.processed || 0;
          migrated += result.migrated || 0;
          alreadyPresent += result.alreadyPresent || 0;
          skipped += result.skipped || 0;
          processedTotal += result.processed || 0;
          migratedTotal += result.migrated || 0;
          alreadyPresentTotal += result.alreadyPresent || 0;
          skippedTotal += result.skipped || 0;
          if (!result.complete && !result.cursor) throw new Error(`The ${phase} migration stopped without a continuation cursor.`);
          cursor = result.cursor || null;
          this.migrationStatus = `Migrating ${phase}: ${processed} scanned, ${migrated} copied, ${alreadyPresent} already present, ${skipped} skipped. Total: ${processedTotal} scanned.`;
          if (typeof window.render === 'function') window.render();
        } while (cursor);
      }
      this.migrationStatus = skippedTotal
        ? `Migration finished: ${migratedTotal} copied, ${alreadyPresentTotal} already present, ${skippedTotal} skipped. Review skipped records before relying on D1-only data. Original KV copies remain available.`
        : `Migration complete: ${migratedTotal} copied, ${alreadyPresentTotal} already present, 0 skipped. Original KV copies remain available.`;
    } catch (error) {
      this.error = error.message;
      this.migrationStatus = 'Migration paused. You can safely run it again.';
    } finally {
      this.migrating = false;
      await this.refresh();
    }
  },

  async setRole(username, role) {
    try {
      const response = await fetch(`${WORKER_API}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.getToken() },
        body: JSON.stringify({ username, role })
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'Account not found.' : `HTTP ${response.status}`);
      await this.refresh();
    } catch (error) {
      this.error = error.message;
      if (typeof window.render === 'function') window.render();
    }
  },

  async setAIAccess(username, enabled) {
    try {
      const response = await fetch(`${WORKER_API}/admin/ai-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.getToken() },
        body: JSON.stringify({ username, enabled })
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'Account not found.' : `HTTP ${response.status}`);
      await this.refresh();
    } catch (error) {
      this.error = error.message;
      if (typeof window.render === 'function') window.render();
    }
  },
  async refresh() {
    if (!this.getToken()) return;
    this.loading = true;
    this.error = '';
    if (typeof window.render === 'function') window.render();
    try {
      const session = await this.request('/auth/session');
      this.role = session.role;
      this.username = session.username;
      const [quotes, dates, feedback, publicRevision] = await Promise.all([
        this.request('/pending'),
        this.request('/dv/pending'),
        this.request('/feedback/list'),
        this.request('/revision/public/admin-list')
      ]);
      this.items = [
        ...(quotes.items || []).map((item) => ({ ...item, _source: 'QuoteVault', _kind: 'quote' })),
        ...(dates.items || []).map((item) => ({ ...item, _source: 'DateVault', _kind: 'date' })),
        ...(feedback.items || []).map((item) => ({ ...item, _source: 'Feedback', _kind: 'feedback' })),
        ...(publicRevision.notes || []).map((item) => ({ ...item, _source: 'Public Revision note', _kind: 'revision-note', _pending: Boolean(item.pending) }))
      ].sort((a, b) => String(b.submittedAt || b.timestamp || '').localeCompare(String(a.submittedAt || a.timestamp || '')));
      this.users = this.role === 'owner' ? (await this.request('/admin/users')).users || [] : [];
    } catch (error) {
      this.error = error.message;
      if (error.message === 'HTTP 401') {
        this.token = null;
        this.role = null;
        this.username = null;
        sessionStorage.removeItem('gcse_vault_admin_token');
      }
    } finally {
      this.loading = false;
      if (typeof window.render === 'function') window.render();
    }
  },

  async action(index, action) {
    const item = this.items[index];
    if (!item) return;
    const routes = {
      quote: { approve: '/approve', reject: '/reject', edit: '/update-pending' },
      date: { approve: '/dv/approve', reject: '/dv/reject', edit: '/dv/update-pending' },
      feedback: { delete: '/feedback/delete' },
      'revision-note': { approve: '/revision/public/approve', reject: '/revision/public/reject', edit: '/revision/public/update', delete: '/revision/public/admin-delete' }
    };
    const path = routes[item._kind]?.[action];
    if (!path) return;
    try {
      const body = { id: item.id };
      if (action === 'edit') {
        window.location.href = `/GcseVault/admin/editor.html?kind=${encodeURIComponent(item._kind)}&id=${encodeURIComponent(item.id)}`;
        return;
      }
      const response = await fetch(`${WORKER_API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.getToken() },
        body: JSON.stringify(body)
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
    if (token && !this.role && !this.loading) this.refresh();
    if (!token) {
      if (!this.statusChecked) {
        this.checkStatus();
        return `<div><div class="pt">Admin Panel</div><div class="ps">Checking account permissions...</div></div>`;
      }
      const account = VaultUser.getUsername();
      return `<div>${typeof backBtn === 'function' ? backBtn() : ''}
        <div class="pt">Admin Panel</div>
        <div class="ps">One shared review queue for QuoteVault, DateVault, and Feedback</div>
        <div class="card" style="max-width:380px">
          <div class="knowledge-title">${account ? `Signed in account: ${UI.escapeHTML(account)}` : 'No account linked'}</div>
          <div class="knowledge-meta" style="margin:6px 0 10px">${account ? 'Admin access is linked to your GCSE Vault account.' : 'Link your GCSE Vault account in Settings first.'}</div>
          <button class="btn bg" onclick="AdminManager.login()" ${account ? '' : 'disabled'}>🔐 Sign in with account</button>
          ${!this.ownerInitialized ? `<details style="margin-top:14px">
            <summary style="cursor:pointer;color:var(--text2);font-size:.75rem">First owner setup</summary>
            <div class="fg" style="margin-top:9px"><label for="admin-bootstrap-key">One-time setup key</label><input type="password" id="admin-bootstrap-key" autocomplete="off" placeholder="Initial setup key"></div>
            <button class="btn" onclick="AdminManager.bootstrap()" ${account ? '' : 'disabled'}>Set up this account as owner</button>
          </details>` : ''}
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
        : item._kind === 'date' ? `${item.year || ''} · ${item.topic || ''}` : item._kind === 'revision-note' ? `${item.cards?.length || 0} cards · ${item.subject || ''} · ${item.level || ''}` : item.description;
      const reviewControls = item._kind === 'revision-note' && !item._pending ? '' : `<button class="btn bsm" onclick="AdminManager.action(${index}, 'approve')">✅ Approve</button><button class="btn bsm br" onclick="AdminManager.action(${index}, 'reject')">❌ Reject</button>`;
      const controls = item._kind === 'feedback'
        ? `<button class="btn bsm br" onclick="AdminManager.action(${index}, 'delete')">🗑 Delete</button>`
        : `${reviewControls}<button class="btn bsm" onclick="AdminManager.action(${index}, 'edit')">✏ Edit full data</button>${item._kind === 'revision-note' ? `<button class="btn bsm br" onclick="AdminManager.action(${index}, 'delete')">🗑 Delete</button>` : ''}`;
      const submittedData = { ...item };
      delete submittedData._source;
      delete submittedData._kind;
      delete submittedData._pending;
      return `<div class="card" style="margin-bottom:8px;border-left:3px solid var(--amber)">
        <div class="tag tg">${UI.escapeHTML(item._source)}</div>
        <div style="font-weight:600;margin-top:5px">${UI.escapeHTML(title || 'Untitled')}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:4px">${UI.escapeHTML(detail || '')}</div>
        <div style="font-size:.62rem;color:var(--text3);margin-top:5px">${UI.escapeHTML(item.submittedAt || item.timestamp || '')}</div>
        <details style="margin-top:9px">
          <summary style="cursor:pointer;font-size:.72rem;color:var(--text2)">View all submitted data</summary>
          <pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;font-size:.68rem;background:var(--bg2);padding:9px;border-radius:7px;margin-top:7px">${UI.escapeHTML(JSON.stringify(submittedData, null, 2))}</pre>
        </details>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${controls}</div>
      </div>`;
    }).join('');
    const userManagement = this.role === 'owner' ? `<div class="card" style="margin:12px 0">
      <div class="sec" style="margin-top:0">Account permissions</div>
      <div class="knowledge-meta" style="margin-bottom:8px">Admins inherit AI access. Only the owner can grant AI access to standard accounts.</div>
      <button class="btn bsm" onclick="AdminManager.migrateStorage()" ${this.migrating ? 'disabled' : ''}>${this.migrating ? 'Migrating...' : 'Migrate existing storage to D1'}</button>
      ${this.migrationStatus ? `<div class="knowledge-meta" style="margin:7px 0">${UI.escapeHTML(this.migrationStatus)}</div>` : ''}
      ${this.users.map(user => `<div class="srow" style="align-items:center;gap:10px;flex-wrap:wrap"><div style="min-width:110px;flex:1"><div class="knowledge-title">${UI.escapeHTML(user.username)}</div></div><div style="display:flex;gap:7px;flex-wrap:wrap"><select aria-label="Role for ${UI.escapeHTML(user.username)}" onchange="AdminManager.setRole(this.dataset.username,this.value)" data-username="${UI.escapeHTML(user.username)}" class="admin-permission-select" style="max-width:145px;padding:7px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg2);color:var(--text);font:inherit" ${user.role === 'owner' ? 'disabled' : ''}><option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>${user.role === 'owner' ? '<option value="owner" selected>Owner</option>' : ''}</select><select aria-label="AI access for ${UI.escapeHTML(user.username)}" onchange="AdminManager.setAIAccess(this.dataset.username,this.value==='enabled')" data-username="${UI.escapeHTML(user.username)}" class="admin-permission-select" style="max-width:145px;padding:7px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg2);color:var(--text);font:inherit" ${user.role !== 'user' ? 'disabled' : ''}><option value="disabled" ${!user.ai_access ? 'selected' : ''}>No AI access</option><option value="enabled" ${user.ai_access ? 'selected' : ''}>AI access</option></select></div></div>`).join('') || '<div class="ps">No accounts found.</div>'}
    </div>` : '';
    return `<div>${typeof backBtn === 'function' ? backBtn() : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div><div class="pt">Admin Panel</div><div class="knowledge-meta"><a href="/GcseVault/admin/" style="color:var(--gold)">Open full moderation workspace</a></div><div class="ps">${UI.escapeHTML(this.username || '')} · ${UI.escapeHTML(this.role || 'Admin')}</div></div>
        <div style="display:flex;gap:6px"><button class="btn bsm" onclick="AdminManager.refresh()">🔄 Refresh</button><button class="btn bsm" onclick="AdminManager.logout()">🔒 Logout</button></div>
      </div>
      ${this.error ? `<div class="qfb qwr">${UI.escapeHTML(this.error)}</div>` : ''}
      ${userManagement}
      <div class="g4" style="margin:10px 0 12px">
        <div class="scard"><div class="snum">${counts.quote || 0}</div><div class="slbl">QuoteVault</div></div>
        <div class="scard"><div class="snum">${counts.date || 0}</div><div class="slbl">DateVault</div></div>
        <div class="scard"><div class="snum">${counts.feedback || 0}</div><div class="slbl">Feedback</div></div>
        <div class="scard"><div class="snum">${counts['revision-note'] || 0}</div><div class="slbl">Revision</div></div>
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