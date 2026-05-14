/**
 * js/guest-profile.js
 * Local guest identity system — no backend, no auth.
 * Avatar registry + profile persistence via localStorage.
 */

export const AVATAR_REGISTRY = [
  '/assets/avatars/bat-midnight-hoodie.jpeg',
  '/assets/avatars/rabbit-night-headphones.jpeg',
  '/assets/avatars/shark-neon-sleepy.jpeg',
  '/assets/avatars/moon-spirit-neon.jpeg',
  '/assets/avatars/cat-sleepy-purple.jpeg',
  '/assets/avatars/duck-late-night.jpeg',
  '/assets/avatars/owl-midnight-study.jpeg',
  '/assets/avatars/fox-hoodie-night.jpeg',
  '/assets/avatars/penguin-chill-headphones.jpeg',
  '/assets/avatars/jellyfish-neon-glow.jpeg',
  '/assets/avatars/Sleepy_black_cat_mascot_icon_202605120318.jpeg',
  '/assets/avatars/star-spirit-dreamy.jpeg',
  '/assets/avatars/ghost-soft-glow.jpeg',
  '/assets/avatars/frog-headphones-lofi.jpeg',
  '/assets/avatars/bear-pixel-hoodie.jpeg',
  '/assets/avatars/robot-lofi-neon.jpeg',
  '/assets/avatars/blob-spirit-soft.jpeg',
  '/assets/avatars/cassette-lofi-retro.jpeg',
  '/assets/avatars/cloud-dreamy-stars.jpeg',
  '/assets/avatars/raccoon-cassette-lofi.jpeg',
];

const PROFILE_KEY = 'mm_guest_profile';

/* Stable clientId — persists across sessions/rooms in the same browser */
function getOrCreateClientId() {
  try {
    const raw = localStorage.getItem('mm_client_id');
    if (raw) return raw;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('mm_client_id', id);
    return id;
  } catch (_) {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

const ADJECTIVES = [
  'Sleepy', 'Midnight', 'Lofi', 'Cosmic', 'Velvet',
  'Silent', 'Dreamy', 'Starry', 'Quiet', 'Neon',
  'Shadow', 'Moonlit', 'Fuzzy', 'Cozy', 'Glowing',
];
const NOUNS = [
  'Fox', 'Cat', 'Bear', 'Owl', 'Ghost',
  'Star', 'Moon', 'Rain', 'Cloud', 'Wave',
  'Echo', 'Haze', 'Mist', 'Bloom', 'Drift',
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateNickname() {
  return randomFrom(ADJECTIVES) + randomFrom(NOUNS) + Math.floor(Math.random() * 99);
}

function generateRandomAvatar() {
  const idx = Math.floor(Math.random() * AVATAR_REGISTRY.length);
  return AVATAR_REGISTRY[idx];
}

export function getClientId() {
  return getOrCreateClientId();
}

/**
 * Returns current guest profile, auto-creating one if none exists.
 * Always ensures clientId is present and persisted.
 */
export function getGuestProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const profile = JSON.parse(raw);
      if (profile.nickname && profile.avatar) {
        // Normalize: ensure clientId is always present
        if (!profile.clientId) {
          profile.clientId = getOrCreateClientId();
          saveGuestProfile(profile);
        }
        return profile;
      }
    }
  } catch (_) {}

  // Auto-create
  const profile = {
    clientId: getOrCreateClientId(),
    nickname: generateNickname(),
    avatar: generateRandomAvatar(),
    createdAt: Date.now(),
  };
  saveGuestProfile(profile);
  return profile;
}

/**
 * Returns only the clientId string (convenience).
 */
export function getGuestClientId() {
  return getOrCreateClientId();
}

/**
 * Persist guest profile to localStorage.
 */
export function saveGuestProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (_) {}
}

/**
 * Returns a fresh random profile without saving.
 */
export function generateRandomProfile() {
  return {
    nickname: generateNickname(),
    avatar: generateRandomAvatar(),
  };
}

/**
 * Returns only the avatar URL from a profile (for convenience).
 */
export function getGuestAvatar() {
  return getGuestProfile().avatar;
}

/**
 * Returns only the nickname from a profile (for convenience).
 */
export function getGuestNickname() {
  return getGuestProfile().nickname;
}

/**
 * Returns the avatar filename without path and extension.
 * e.g. "/assets/avatars/cat-sleepy-purple.jpeg" -> "cat-sleepy-purple"
 */
export function getAvatarId(avatarPath) {
  if (!avatarPath) return '';
  const filename = avatarPath.split('/').pop() || '';
  return filename.replace(/\.[^/.]+$/, '');
}
