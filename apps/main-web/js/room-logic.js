/**
 * room-logic.js
 * Centralized, UI-agnostic multiplayer logic layer.
 * Uses Adapter pattern to interact with different UI implementations (Homepage, RoomHub).
 */

// Global Debug Mode (can be toggled in console)
window.MM_DEBUG = window.MM_DEBUG || false;

const RoomLogic = {
  socket: null,
  _isJoining: false,
  _pendingJoin: null,
  // Tracks the most recent create state for host auto-join
  _lastCreateState: null,
  
  /**
   * Internal trace logger
   */
  _trace(action, data = '') {
    if (window.MM_DEBUG) {
      console.log(`%c[RoomLogic][${action}]`, 'color: #00d4ff; font-weight: bold;', data);
    }
  },

  /**
   * Initialize socket connection if not already present.
   * Returns existing or new socket.
   */
  getSocket() {
    if (this.socket) return this.socket;
    
    const socketUrl = window.CONFIG?.SOCKET_URL || window.location.origin;
    if (typeof io === 'undefined') {
      console.error('[RoomLogic] socket.io not loaded');
      return null;
    }
    
    this._trace('INIT', `Connecting to ${socketUrl}`);
    
    this.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    
    this._setupBaseListeners();
    return this.socket;
  },

  _setupBaseListeners() {
    if (!this.socket) return;
    
    this.socket.on('connect', () => {
      console.log(`[socket] connected id=${this.socket.id} url=${socketUrl}`);
      this._trace('CONNECTED', this.socket.id);
    });

    this.socket.on('connect_error', (err) => {
      console.error('[socket] connect_error', err?.message || err);
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected reason=${reason}`);
      this._trace('DISCONNECTED', reason);
    });
  },

  /**
   * ── CREATE ROOM ──────────────────────────────────────────
   */
  createRoom({ username, roomName, mood, isPrivate, password, onSuccess, onError }) {
    this._trace('CREATE_REQ', { roomName, mood, isPrivate });

    // 1. Validation
    if (!username?.trim()) return onError?.('Vui lòng nhập tên của bạn');
    if (!roomName?.trim()) return onError?.('Vui lòng nhập tên phòng');
    if (!mood) return onError?.('Vui lòng chọn không khí cho phòng');
    if (isPrivate && !password?.trim()) return onError?.('Cần đặt mật khẩu cho phòng riêng tư');

    const s = this.getSocket();
    if (!s) return onError?.('Hệ thống socket chưa sẵn sàng');

    // 2. Persist username
    this.saveUsername(username);

    // 3. Save create state for host auto-join (host needs password on private rooms)
    this._lastCreateState = { isPrivate, password };

    // 4. Clear existing listeners to avoid duplicates
    s.off(ROOM_EVENTS.ROOM_CREATED);
    s.off(ROOM_EVENTS.ROOM_ERROR);

    // 5. Setup single-use response listeners
    s.once(ROOM_EVENTS.ROOM_CREATED, (data) => {
      this._trace('ROOM_CREATED', data.roomId);

      // Save host token and create state to sessionStorage so room-page can use them
      this.saveHostToken(data.roomId, data.hostToken);
      this.saveCreateState(data.roomId, this._lastCreateState);

      onSuccess?.(data);
    });

    s.once(ROOM_EVENTS.ROOM_ERROR, (msg) => {
      this._trace('CREATE_ERROR', msg);
      this._lastCreateState = null;
      onError?.(msg);
    });

    // 6. Emit
    s.emit(ROOM_EVENTS.CREATE_ROOM, {
      name: username.trim(),
      roomName: roomName.trim(),
      mood,
      isPrivate: !!isPrivate,
      password: isPrivate ? password : ''
    });
  },

  /**
   * ── JOIN ROOM (STEP 1: Access Check) ──────────────────────
   */
  checkAccess(roomId, { onPublic, onPrivate, onNotFound, onError }) {
    const s = this.getSocket();
    if (!s) return onError?.('Socket not ready');

    const cleanId = roomId.trim().toUpperCase();
    if (!cleanId) return onError?.('Vui lòng nhập mã phòng');

    this._trace('CHECK_ACCESS', cleanId);

    s.off(ROOM_EVENTS.ROOM_ACCESS_CHECKED);
    s.once(ROOM_EVENTS.ROOM_ACCESS_CHECKED, ({ exists, isPrivate }) => {
      this._trace('ACCESS_RESULT', { exists, isPrivate });
      if (!exists) return onNotFound?.();
      if (isPrivate) return onPrivate?.(cleanId);
      onPublic?.(cleanId);
    });

    s.emit(ROOM_EVENTS.CHECK_ROOM_ACCESS, { roomId: cleanId });
  },

  /**
   * ── JOIN ROOM (STEP 2: Actual Join) ───────────────────────
   */
  joinRoom(roomId, password = '', { username, onSuccess, onError } = {}) {
    if (this._isJoining) {
      this._trace('JOIN_BLOCKED', 'Already in progress');
      return;
    }
    this._isJoining = true;

    const s = this.getSocket();
    const finalName = username?.trim() || this.getSavedUsername() || `Guest_${Math.floor(Math.random() * 9000 + 1000)}`;
    
    this._trace('JOIN_REQ', { roomId, finalName, hasPassword: !!password });

    s.off(ROOM_EVENTS.JOINED_ROOM);
    s.off(ROOM_EVENTS.ROOM_ERROR);

    s.once(ROOM_EVENTS.JOINED_ROOM, (data) => {
      this._trace('JOIN_SUCCESS', data.roomId);
      this._isJoining = false;
      if (password) this.saveJoinPassword(roomId, password);
      onSuccess?.(data);
    });

    s.once(ROOM_EVENTS.ROOM_ERROR, (msg) => {
      this._trace('JOIN_ERROR', msg);
      this._isJoining = false;
      onError?.(msg);
    });

    s.emit(ROOM_EVENTS.JOIN_ROOM, {
      roomId,
      name: finalName,
      password: password || ''
    });
  },

  /**
   * ── STORAGE HELPERS ───────────────────────────────────────
   */
  saveUsername(name) {
    this._trace('SAVE_USER', name);
    try { localStorage.setItem(ROOM_STORAGE.USERNAME, name.trim()); } catch(_) {}
  },

  getSavedUsername() {
    try { return localStorage.getItem(ROOM_STORAGE.USERNAME) || ''; } catch(_) { return ''; }
  },

  saveHostToken(roomId, token) {
    this._trace('SAVE_HOST_TOKEN', { roomId, token: token.substring(0, 8) + '...' });
    try { sessionStorage.setItem(ROOM_STORAGE.HOST_TOKEN + roomId, token); } catch(_) {}
  },

  saveJoinPassword(roomId, pw) {
    this._trace('SAVE_JOIN_PW', roomId);
    try { sessionStorage.setItem(ROOM_STORAGE.JOIN_PASSWORD + roomId, pw); } catch(_) {}
  },

  /**
   * saveCreateState — persist the create-time state (isPrivate + password)
   * so room-page can attach it to the host auto-join emit.
   */
  saveCreateState(roomId, createState) {
    this._trace('SAVE_CREATE_STATE', { roomId, isPrivate: createState?.isPrivate });
    try { sessionStorage.setItem('mm_createState_' + roomId, JSON.stringify(createState)); } catch(_) {}
  },

  /**
   * getCreateState — retrieve create-time state for a given roomId.
   * Returns null if not found.
   */
  getCreateState(roomId) {
    try {
      const raw = sessionStorage.getItem('mm_createState_' + roomId);
      if (raw) return JSON.parse(raw);
    } catch(_) {}
    return null;
  },

  /**
   * clearCreateState — remove create state after successful host join.
   * Prevents stale create state from being reused.
   */
  clearCreateState(roomId) {
    this._trace('CLEAR_CREATE_STATE', roomId);
    try { sessionStorage.removeItem('mm_createState_' + roomId); } catch(_) {}
  }
};

window.RoomLogic = RoomLogic;
