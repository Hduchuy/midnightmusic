/**
 * js/avatar-picker.js
 * AvatarPicker component — DOM-based, zero framework.
 * Creates a grid picker and emits selection events.
 * Matches project: dark glassmorphism, cozy aesthetic.
 */

import { AVATAR_REGISTRY } from './guest-profile.js';

/**
 * AvatarPicker — renders an avatar grid inside a given container.
 *
 * @param {Object} opts
 * @param {string} opts.containerSelector  - CSS selector for container element
 * @param {string} opts.selectedAvatar    - Currently selected avatar URL (initially)
 * @param {Function} opts.onSelect        - Called with (avatarUrl) on selection change
 * @param {number} opts.cols              - Grid columns (default: auto-fill)
 */
export class AvatarPicker {
  constructor(opts = {}) {
    this.containerSelector = opts.containerSelector || '#avatar-picker';
    this.selectedAvatar = opts.selectedAvatar || '';
    this.onSelect = opts.onSelect || (() => {});
    this._items = [];
  }

  mount() {
    const container = document.querySelector(this.containerSelector);
    if (!container) return;

    // Build grid
    container.innerHTML = '';
    container.classList.add('avatar-picker-grid');

    AVATAR_REGISTRY.forEach((avatarUrl) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'avatar-picker-item';
      item.setAttribute('aria-label', `Chọn avatar ${avatarUrl.split('/').pop().replace(/\.[^/.]+$/, '')}`);
      item.dataset.avatar = avatarUrl;

      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.loading = 'lazy';

      item.appendChild(img);
      container.appendChild(item);

      if (avatarUrl === this.selectedAvatar) {
        item.classList.add('selected');
      }

      item.addEventListener('click', () => this._select(avatarUrl, item));

      this._items.push(item);
    });
  }

  _select(avatarUrl, clickedItem) {
    // Remove previous selection
    this._items.forEach(item => item.classList.remove('selected'));

    // Mark new selection
    clickedItem.classList.add('selected');
    this.selectedAvatar = avatarUrl;

    // Notify
    this.onSelect(avatarUrl);
  }

  setSelected(avatarUrl) {
    this.selectedAvatar = avatarUrl;
    this._items.forEach(item => {
      if (item.dataset.avatar === avatarUrl) {
        item.classList.add('selected');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }
}
