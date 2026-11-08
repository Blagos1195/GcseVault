(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const iterations = 600000;

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(value) {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
  }

  async function deriveKey(password, salt) {
    if (typeof password !== 'string' || password.length < 12) {
      throw new Error('Use a password with at least 12 characters.');
    }
    const material = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return { version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  }

  async function decrypt(key, envelope) {
    if (!envelope || envelope.version !== 1 || !envelope.iv || !envelope.ciphertext) {
      throw new Error('Encrypted data format is not supported.');
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext)
    );
    return JSON.parse(decoder.decode(plaintext));
  }

  async function createRecoveryPackage(key) {
    const recoveryKey = crypto.getRandomValues(new Uint8Array(32));
    const recoveryCryptoKey = await crypto.subtle.importKey(
      'raw',
      recoveryKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const rawEncryptionKey = await crypto.subtle.exportKey('raw', key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      recoveryCryptoKey,
      rawEncryptionKey
    );
    return {
      recoveryKey: toBase64(recoveryKey),
      wrappedKey: {
        version: 1,
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(wrapped))
      }
    };
  }

  async function recoverKey(recoveryKeyValue, wrappedKey) {
    if (!wrappedKey || wrappedKey.version !== 1) {
      throw new Error('Recovery data format is not supported.');
    }
    const recoveryCryptoKey = await crypto.subtle.importKey(
      'raw',
      fromBase64(recoveryKeyValue),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const rawKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrappedKey.iv) },
      recoveryCryptoKey,
      fromBase64(wrappedKey.ciphertext)
    );
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  window.GcseVaultCrypto = Object.freeze({
    createSalt() {
      return toBase64(crypto.getRandomValues(new Uint8Array(16)));
    },
    deriveKey,
    encrypt,
    decrypt,
    createRecoveryPackage,
    recoverKey
  });
})();
