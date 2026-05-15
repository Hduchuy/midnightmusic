import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// CORS: fixed list + optional FRONTEND_ORIGINS (comma-separated) for Vercel previews / extra domains
const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://music.hduchuy.id.vn',
  'https://www.music.hduchuy.id.vn',
];
const EXTRA_ORIGINS = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [...new Set([...DEFAULT_FRONTEND_ORIGINS, ...EXTRA_ORIGINS])];

function corsOriginChecker(origin, callback, label) {
  if (!origin) return callback(null, true);
  if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
  console.warn(`[cors] blocked ${label}: ${origin}`);
  callback(new Error('Not allowed by CORS'));
}

const io = new Server(httpServer, {
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
  cors: {
    origin: (origin, callback) => corsOriginChecker(origin, callback, 'socket'),
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: (origin, callback) => corsOriginChecker(origin, callback, 'http'),
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());

// ── SoundCloud Search Proxy ────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { q, limit: queryLimit } = req.query;
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;

  if (!q)        return res.status(400).json({ error: 'Missing keyword (q)' });
  if (!clientId) return res.status(500).json({ error: 'Missing SOUNDCLOUD_CLIENT_ID' });

  const limit = parseInt(queryLimit, 10) || 10;
  const url   = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${clientId}&limit=${limit}`;

  try {
    const response = await fetch(url);
    const textData = await response.text();
    if (!response.ok) {
      let errorMsg = `SoundCloud API returned ${response.status}`;
      try { const errObj = JSON.parse(textData); if (errObj.message) errorMsg = errObj.message; } catch (_) {}
      return res.status(response.status).json({ error: errorMsg });
    }
    res.json(JSON.parse(textData));
  } catch (err) {
    console.error('[Search API] Fetch Error:', err.stack);
    res.status(500).json({ error: 'Internal Server Error during fetch' });
  }
});

// ── YouTube InnerTube Search ───────────────────────────────────────────────
app.get('/api/yt-search', async (req, res) => {
  const { q, continuation } = req.query;
  if (!q && !continuation) return res.status(400).json({ error: 'Missing query' });

  const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false';
  const body = {
    context: {
      client: { clientName: 'WEB', clientVersion: '2.20231219.01.00', hl: 'en', gl: 'US' },
    },
    ...(continuation ? { continuation } : { query: q }),
  };

  try {
    const ytRes = await fetch(INNERTUBE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
      body: JSON.stringify(body),
    });

    if (!ytRes.ok) return res.status(502).json({ error: 'InnerTube error', status: ytRes.status });

    const data = await ytRes.json();
    const items = [];
    let nextContinuation = null;

    const sectionList =
      data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ||
      data.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems ||
      [];

    for (const section of sectionList) {
      if (section.continuationItemRenderer) {
        nextContinuation = section.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
        continue;
      }
      for (const item of (section.itemSectionRenderer?.contents || [])) {
        const vr = item.videoRenderer;
        if (!vr?.videoId) continue;

        // Skip if duration is missing (usually means it's a live stream or upcoming)
        const durationText = vr.lengthText?.simpleText || '';
        if (!durationText) continue;

        const title = vr.title?.runs?.map(r => r.text).join('') || '';
        if (!title) continue;

        const badges = (vr.badges?.map(b => b.metadataBadgeRenderer?.label?.toLowerCase() || '') || []);
        const overlayBadges = (vr.thumbnailOverlays?.map(o => o.thumbnailOverlayTimeStatusRenderer?.style?.toLowerCase() || '') || []);
        const allBadges = [...badges, ...overlayBadges];

        // Strict unplayable filters
        const statusText = vr.shortViewCountText?.simpleText?.toLowerCase() || '';
        const isUpcoming = !!vr.upcomingEventData || statusText.includes('scheduled') || statusText.includes('upcoming');
        if (isUpcoming) continue;

        if (allBadges.some(b => b.includes('live') || b.includes('premiere') || b.includes('offline'))) continue;
        if (allBadges.some(b => b.includes('age') || b.includes('restricted') || b.includes('members only'))) continue;

        const dParts = durationText.split(':').map(Number);
        const dSecs  = dParts.length === 3
          ? dParts[0] * 3600 + dParts[1] * 60 + dParts[2]
          : dParts.length === 2 ? dParts[0] * 60 + dParts[1] : dParts[0];
        
        // Skip too short videos (< 60s) often unusable or shorts
        if (dSecs < 60) continue;

        items.push({
          id: vr.videoId,
          title,
          author: vr.ownerText?.runs?.map(r => r.text).join('') || '',
          duration: durationText,
          views: vr.shortViewCountText?.simpleText || '',
          thumb: `https://img.youtube.com/vi/${vr.videoId}/maxresdefault.jpg`,
        });
        if (items.length >= 12) break;
      }
      if (items.length >= 12) break;
    }

    res.json({ collection: items, nextPageToken: nextContinuation });
  } catch (err) {
    console.error('[YT Search] Error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});


// ============================================================
// Socket.io — Room Management System
// ============================================================

/**
 * Room schema (authoritative):
 * {
 *   roomId, roomName, hostId, hostToken, hostName, mood, isPrivate, password,
 *   createdAt, updatedAt,
 *   members: Map<socketId, { id, name }>,
 *   state: {
 *     mood,
 *     currentTrackId, currentTrackIndex, trackVersion, lastActionSource,
 *     isPlaying, currentTime, syncedAt
 *   },
 *   playlist: Array,
 * }
 */
const rooms = new Map();

// Room never joined: delete after this long (create-room → join-room gap)
const EMPTY_ROOM_GRACE_MS = 10 * 60 * 1000;

// Grace period for host reconnect (ms)
const HOST_RECONNECT_GRACE_MS = 15000;

// Track host disconnect timestamps and grace period timers
// Map<roomId, { disconnectedAt, timer }>
const hostDisconnectTimers = new Map();

function generateRoomId() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function sanitizeRoomId(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
}

function sanitizeText(raw, maxLen = 300) {
  return String(raw || '').substring(0, maxLen);
}

function getTrackIndex(room, videoId) {
  if (!room?.playlist?.length || !videoId) return -1;
  return room.playlist.findIndex(track => track.id === videoId);
}

function buildTrackChangedPayload(room) {
  return {
    currentVideoId: room.state.currentVideoId,
    currentTrackId: room.state.currentTrackId,
    currentTrackIndex: room.state.currentTrackIndex,
    trackVersion: room.state.trackVersion,
    lastActionId: room.state.lastActionId || 0,
    lastActionSource: room.state.lastActionSource,
    lastAuthoritativeAction: room.state.lastAuthoritativeAction || null,
    isPlaying: room.state.isPlaying,
    currentTime: room.state.currentTime,
    syncedAt: room.state.syncedAt,
    lastTrackChangeAt: room.state.lastTrackChangeAt || 0,
  };
}

function applyAuthoritativeTrackChange(room, track, trackIndex, {
  actionSource = 'select',
  currentTime = 0,
  isPlaying = true,
  actorSocketId = null,
} = {}) {
  room.state.currentVideoId = track?.id || null;
  room.state.currentTrackId = track?.id || null;
  room.state.currentTrackIndex = Number.isInteger(trackIndex) ? trackIndex : -1;
  room.state.trackVersion = (room.state.trackVersion || 0) + 1;
  room.state.lastActionId = (room.state.lastActionId || 0) + 1;
  room.state.lastActionSource = actionSource;
  room.state.currentTime = currentTime;
  room.state.isPlaying = isPlaying;
  room.state.syncedAt = Date.now();
  room.state.lastTrackChangeAt = Date.now();
  room.updatedAt = Date.now();

  // Exit idle when a track starts
  room.isIdle = false;

  // Store authoritative action for multi-controller scenarios
  room.state.lastAuthoritativeAction = {
    actionId: room.state.lastActionId,
    actionType: 'track_change',
    actorSocketId: actorSocketId,
    timestamp: Date.now(),
    currentTime,
    isPlaying,
  };
}

/** Remove member entries whose sockets are no longer connected (ghost cleanup). */
function pruneDeadSocketsFromRoom(room) {
  if (!room?.members?.size) return 0;
  let removed = 0;
  for (const sid of room.members.keys()) {
    if (!io.sockets.sockets.has(sid)) {
      room.members.delete(sid);
      removed++;
    }
  }
  if (removed && Array.isArray(room.state?.controllerIds)) {
    room.state.controllerIds = room.state.controllerIds.filter((id) => io.sockets.sockets.has(id));
  }
  return removed;
}

function closeRoom(roomId, reason = 'host') {
  const room = rooms.get(roomId);
  if (!room) return;
  const memberCount = room.members.size;
  if (hostDisconnectTimers.has(roomId)) {
    clearTimeout(hostDisconnectTimers.get(roomId).timer);
    hostDisconnectTimers.delete(roomId);
  }
  console.log(`[room] closed id=${roomId} reason=${reason} members=${memberCount} roomsBefore=${rooms.size}`);
  io.to(roomId).emit('room-closed', { reason });
  io.in(roomId).socketsLeave(roomId);
  rooms.delete(roomId);
  console.log(`[room] stats activeRooms=${rooms.size}`);
}

// Periodic: prune ghosts, empty lobby timeout, inactivity with members
const INACTIVITY_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const pruned = pruneDeadSocketsFromRoom(room);
    if (pruned > 0) {
      console.log(`[room] prune id=${roomId} removed=${pruned} members=${room.members.size}`);
      room.updatedAt = Date.now();
      if (room.members.size > 0) {
        io.to(roomId).emit('members-updated', {
          members: Array.from(room.members.values()),
          serverTime: Date.now(),
        });
      }
    }

    const emptyNeverJoined = room.members.size === 0 && now - room.createdAt > EMPTY_ROOM_GRACE_MS;
    const staleWithMembers = room.members.size > 0 && now - room.updatedAt > INACTIVITY_MS;

    if (emptyNeverJoined) {
      console.log(`[room] cleanup id=${roomId} reason=empty_timeout ageMs=${now - room.createdAt}`);
      closeRoom(roomId, 'empty_timeout');
    } else if (staleWithMembers) {
      console.log(`[room] cleanup id=${roomId} reason=inactivity idleMs=${now - room.updatedAt} members=${room.members.size}`);
      closeRoom(roomId, 'inactivity');
    }
  }
}, 5 * 60 * 1000);

// REST: validate room existence before page load
app.get('/api/room/:id', (req, res) => {
  const roomId = sanitizeRoomId(req.params.id);
  if (!roomId || !rooms.has(roomId)) return res.status(404).json({ exists: false });
  const room = rooms.get(roomId);
  res.json({ exists: true, isPrivate: room.isPrivate, memberCount: room.members.size, createdAt: room.createdAt });
});

io.on('connection', (socket) => {
  console.log(`[socket] connected id=${socket.id}`);

  // ── Helper: get safe controllerIds ───────────────────────
  function getControllerIds(room) {
    if (!room) return [];
    if (!Array.isArray(room.state?.controllerIds)) {
      // Migration: ensure controllerIds exists
      if (room.state) room.state.controllerIds = [];
      else if (!Array.isArray(room.controllerIds)) room.controllerIds = [];
      console.log('[MIGRATION] controllerIds initialized');
    }
    return room.state?.controllerIds || room.controllerIds || [];
  }

  // ── CREATE ROOM ──────────────────────────────────────────
  socket.on('create-room', ({ name, roomName, mood, isPrivate, password } = {}) => {
    const roomId   = generateRoomId();
    const hostName = sanitizeText(name || 'Host', 30);

    const hostToken = Math.random().toString(36).substring(2, 15);
    rooms.set(roomId, {
      roomId,
      roomName:  sanitizeText(roomName || 'Phòng mới', 40),
      hostId:    socket.id, // Initial host ID
      hostToken,            // Verification token
      hostName,
      mood:      mood || 'chill',
      isPrivate: !!isPrivate,
      password:  isPrivate ? sanitizeText(password || '', 30) : '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      members:   new Map(),
      state:     {
        mood: mood || 'chill',
        currentTrackId: null,
        currentTrackIndex: -1,
        trackVersion: 0,
        lastActionId: 0,              // Action versioning để ignore stale events
        lastActionSource: 'init',
        lastAuthoritativeAction: null, // { actionId, actionType, actorSocketId, timestamp }
        isPlaying: false,
        currentVideoId: null,
        currentTime: 0,
        syncedAt: Date.now(),
        lastTrackChangeAt: 0,     // Chống double next
        isTrackChanging: false,   // Lock khi track đang change
        controllerIds: [],         // Danh sách user có quyền điều khiển
      },
      playlist:  [],
      isIdle:    false,   // true when playlist exhausted — room still alive
    });

    console.log(`[room] created id=${roomId} hostSocket=${socket.id} hostName=${hostName} mood=${mood || 'chill'} private=${!!isPrivate} activeRooms=${rooms.size}`);
    socket.emit('room-created', { roomId, hostToken });
  });

  // ── CHECK ROOM ACCESS (for join flow) ─────────────────────
  socket.on('check-room-access', ({ roomId: rawId }) => {
    const roomId = sanitizeRoomId(rawId);
    console.log(`[ROOM][PRIVATE_CHECK] room=${roomId || rawId}`);

    if (!roomId || !rooms.has(roomId)) {
      console.log(`[ROOM][PRIVATE_CHECK][NOT_FOUND] room=${roomId || rawId} activeRooms=${[...rooms.keys()].join(',')}`);
      socket.emit('room-access-checked', { exists: false, isPrivate: false });
      return;
    }

    const room = rooms.get(roomId);
    console.log(`[ROOM][PRIVATE_CHECK][FOUND] room=${roomId} isPrivate=${room.isPrivate} members=${room.members.size} host=${room.hostId}`);
    socket.emit('room-access-checked', {
      exists: true,
      isPrivate: room.isPrivate
    });
    if (room.isPrivate) {
      console.log(`[ROOM][PASSWORD_REQUIRED] room=${roomId}`);
    }
  });

  // ── JOIN ROOM ─────────────────────────────────────────────
  socket.on('join-room', ({ roomId: rawId, name, password, hostToken, avatar, clientId, profile }) => {
    const roomId = sanitizeRoomId(rawId);

    console.log(`[JOIN][REQUEST] rawRoomId=${rawId} sanitizedRoomId=${roomId} socket=${socket.id} user=${sanitizeText(name || 'Guest', 30)} clientId=${clientId || '(none)'} hasToken=${!!hostToken} hasProfile=${!!profile}`);
    console.log(`[JOIN][DEBUG] activeRooms=${[...rooms.keys()].join(',') || '(empty)'}`);

    if (!roomId || !rooms.has(roomId)) {
      console.log(`[JOIN][ERROR] room=${roomId || rawId} socket=${socket.id} reason=missing_room`);
      socket.emit('room-error', '⚠️ Phòng không tồn tại hoặc đã bị đóng.');
      return;
    }

    const room = rooms.get(roomId);
    const ghosts = pruneDeadSocketsFromRoom(room);
    if (ghosts > 0) {
      console.log(`[room] prune-before-join id=${roomId} removed=${ghosts} members=${room.members.size}`);
    }

    // Check if this is a host reconnect (bypasses password)
    const isHostReconnect = (hostToken && hostToken === room.hostToken);

    // Verify password for private rooms (skip if host reconnect)
    if (room.isPrivate && room.password && !isHostReconnect) {
      if (!password || password !== room.password) {
        console.log(`[ROOM][PASSWORD_INVALID] room=${roomId} socket=${socket.id}`);
        socket.emit('room-error', 'Sai mật khẩu phòng');
        return;
      }
      console.log(`[ROOM][PASSWORD_VALID] room=${roomId} socket=${socket.id}`);
    } else if (isHostReconnect) {
      console.log(`[ROOM][HOST_RECONNECT_BYPASS_PASSWORD] room=${roomId} socket=${socket.id}`);
    }

    const safeName = sanitizeText(name || 'Guest', 30);
    const safeAvatar = typeof avatar === 'string' && avatar.length > 0 ? avatar : '';

    // ── Full profile (sent by client) ───────────────────────────────────
    // profile may come from client as { nickname, avatar } or be undefined
    const profileNickname = profile?.nickname ? sanitizeText(profile.nickname, 30) : safeName;
    const profileAvatar   = typeof profile?.avatar === 'string' && profile.avatar.length > 0 ? profile.avatar : safeAvatar;

    // ── clientId deduplication ───────────────────────────────────────────
    // Same clientId = same browser. Update existing member's socket.id
    // instead of creating a duplicate. This prevents "Guest_ui" appearing twice.
    let isReconnect = false;
    const memberProfile = { id: socket.id, name: profileNickname, avatar: profileAvatar, clientId };
    if (clientId) {
      for (const [existingSocketId, memberData] of room.members.entries()) {
        if (memberData.clientId === clientId && existingSocketId !== socket.id) {
          console.log(`[JOIN][CLIENTID_MATCH] room=${roomId} oldSocket=${existingSocketId} newSocket=${socket.id} user=${profileNickname} clientId=${clientId}`);
          room.members.delete(existingSocketId);
          room.members.set(socket.id, memberProfile);
          isReconnect = true;
          break;
        }
      }
    }

    // Check if the joiner is the authorized host (host reclaim)
    const isHostClaim = (hostToken && room.hostToken === hostToken);
    if (isHostClaim) {
      // Cancel grace period timer if host reconnects
      if (hostDisconnectTimers.has(roomId)) {
        clearTimeout(hostDisconnectTimers.get(roomId).timer);
        hostDisconnectTimers.delete(roomId);
        console.log(`[JOIN][HOST-RECLAIM] room=${roomId} grace timer cancelled`);
      }
      console.log(`[JOIN][HOST-RECLAIM] room=${roomId} oldHost=${room.hostId} newHost=${socket.id} user=${safeName}`);
      room.hostId = socket.id;
    }
    // NOTE: If member joins during grace period, do NOT cancel the timer.
    // The room keeps waiting for the original host to reconnect.
    // Timer will fire after grace period if host doesn't return.
    const isHost = (room.hostId === socket.id);

    socket.join(roomId);

    if (!isReconnect) {
      room.members.set(socket.id, { id: socket.id, name: profileNickname, avatar: profileAvatar, clientId: clientId || null });
    }
    room.updatedAt = Date.now();
    socket.roomId = roomId;

    console.log(`[room] joined id=${roomId} socket=${socket.id} user=${profileNickname} isHost=${isHost} members=${room.members.size} reconnect=${isReconnect} video=${room.state.currentVideoId}`);
    console.log(`[JOIN][OK] room=${roomId} socket=${socket.id} playing=${room.state.isPlaying} time=${room.state.currentTime} v=${room.state.trackVersion} playlistLen=${room.playlist.length}`);

    socket.emit('joined-room', {
      roomId,
      roomName: room.roomName,
      isHost,
      hostId:   room.hostId,
      state:    room.state,
      members:  Array.from(room.members.values()),
      playlist: room.playlist,
      serverTime: Date.now(),
      controllerIds: room.state.controllerIds,
      isIdle:    room.isIdle || false,
      // Send back the user's own authoritative profile so they always have it
      myProfile: { id: socket.id, name: profileNickname, avatar: profileAvatar, clientId },
    });

    // On any join, broadcast authoritative members list to EVERYONE (including reconnectors).
    // This ensures all clients have the exact same member list — critical when same-clientId
    // reconnect replaces an old socket, so old tabs can remove the ghost entry.
    const allMembers = Array.from(room.members.values());
    io.to(roomId).emit('members-updated', { members: allMembers, serverTime: Date.now() });

    // Also send old-style member-joined only for genuinely new identities
    if (!isReconnect) {
      console.log(`[JOIN][BROADCAST] room=${roomId} event=member-joined joinedSocket=${socket.id} user=${safeName}`);
      socket.to(roomId).emit('member-joined', { id: socket.id, name: safeName, avatar: safeAvatar, clientId: clientId || null });
    } else {
      console.log(`[JOIN][SILENT] room=${roomId} reconnect=${socket.id} — no member-joined broadcast`);
    }
  });

  // ── CLOSE ROOM (host only) ────────────────────────────────
  socket.on('close-room', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    if (room.hostId !== socket.id) {
      console.log(`[CLOSE][DENY] room=${roomId} socket=${socket.id} user=${room.members.get(socket.id)?.name || 'unknown'} hostId=${room.hostId}`);
      socket.emit('room-error', '⚠️ Chỉ host mới có thể đóng phòng.');
      return;
    }
    console.log(`[CLOSE][OK] room=${roomId} socket=${socket.id} user=${room.members.get(socket.id)?.name || room.hostName} members=${room.members.size}`);
    closeRoom(roomId, 'host');
  });

  // ── MOOD SYNC ─────────────────────────────────────────────
  socket.on('sync-mood', (mood) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    room.state.mood = mood;
    room.updatedAt  = Date.now();
    console.log(`[MOOD][SYNC] room=${roomId} socket=${socket.id} user=${room.members.get(socket.id)?.name || 'unknown'} mood=${mood}`);
    io.to(roomId).emit('mood-changed', mood);
  });

  // ── PLAYLIST ──────────────────────────────────────────────
  socket.on('add-to-playlist', (video) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const alreadyInPlaylist = room.playlist.some(v => v.id === video.id);
    const playlistWasEmpty = room.playlist.length === 0;
    console.log(`[PLAYLIST][ADD][REQUEST] room=${roomId} socket=${socket.id} user=${room.members.get(socket.id)?.name || 'unknown'} videoId=${video?.id} title=${sanitizeText(video?.title || '', 80)} duplicate=${alreadyInPlaylist} playlistWasEmpty=${playlistWasEmpty}`);
    if (!alreadyInPlaylist) {
      // Sanitize video data before storing
      room.playlist.push({
        id:     sanitizeText(video.id, 20),
        title:  sanitizeText(video.title, 200),
        author: sanitizeText(video.author, 100),
        thumb:  sanitizeText(video.thumb, 300),
      });
    }
    room.updatedAt = Date.now();
    console.log(`[PLAYLIST][BROADCAST] room=${roomId} count=${room.playlist.length} ids=${room.playlist.map(v => v.id).join(',')}`);
    io.to(roomId).emit('playlist-updated', room.playlist);

    // ── AUTO-START: Set first track when playlist goes from 0 → 1 ──
    // This is the authoritative fix: server decides, not client.
    // Prevents "playlist has track but currentVideoId=null" race condition.
    if (playlistWasEmpty && !room.state.currentVideoId) {
      const firstTrack = room.playlist[0];
      console.log(`[PLAYLIST][AUTO_START] room=${roomId} playlist was empty, setting first track id=${firstTrack.id}`);

      applyAuthoritativeTrackChange(room, firstTrack, 0, {
        actionSource: 'auto-start',
        currentTime: 0,
        isPlaying: true,
      });

      const payload = buildTrackChangedPayload(room);
      console.log(`[TRACK][SET_FIRST] room=${roomId} index=${payload.currentTrackIndex} video=${payload.currentVideoId} v=${payload.trackVersion}`);
      io.to(roomId).emit('track-changed', payload);
    }

    // ── IDLE RECOVERY: If room is idle and new track added, auto-play it ──
    if (room.isIdle && room.playlist.length > 0) {
      const firstTrack = room.playlist[room.playlist.length - 1]; // most recently added
      room.isIdle = false;
      console.log(`[PLAYLIST][IDLE_RECOVER] room=${roomId} was idle, auto-playing added track id=${firstTrack.id}`);

      // Find its index in the playlist
      const trackIdx = room.playlist.findIndex(t => t.id === firstTrack.id);

      applyAuthoritativeTrackChange(room, firstTrack, trackIdx >= 0 ? trackIdx : 0, {
        actionSource: 'idle-recover',
        currentTime: 0,
        isPlaying: true,
      });

      const payload = buildTrackChangedPayload(room);
      io.to(roomId).emit('track-changed', payload);
    }
  });

  // ── REMOVE FROM PLAYLIST ────────────────────────────────────
  socket.on('remove-from-playlist', ({ trackId } = {}) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const user = room.members.get(socket.id)?.name || 'unknown';

    // Permission check: host or controller only
    const controllerIds = getControllerIds(room);
    const canControl = room.hostId === socket.id || controllerIds.includes(socket.id);
    if (!canControl) {
      console.log(`[PLAYLIST][REMOVE][DENY] room=${roomId} socket=${socket.id} user=${user} trackId=${trackId}`);
      return;
    }

    const idx = getTrackIndex(room, trackId);
    if (idx < 0) {
      console.log(`[PLAYLIST][REMOVE][SKIP] room=${roomId} socket=${socket.id} user=${user} trackId=${trackId} not-found`);
      return;
    }
    const removed = room.playlist[idx];
    console.log(`[PLAYLIST][REMOVE_REQUEST] room=${roomId} socket=${socket.id} user=${user} idx=${idx} id=${trackId} title=${sanitizeText(removed?.title || '', 80)}`);

    // Decrement currentTrackIndex if removing a track before current
    if (idx < room.state.currentTrackIndex) {
      room.state.currentTrackIndex -= 1;
      console.log(`[PLAYLIST][INDEX_UPDATED] currentTrackIndex decremented to ${room.state.currentTrackIndex}`);
    } else if (idx === room.state.currentTrackIndex) {
      // Removing the currently playing track
      console.log(`[PLAYLIST][CURRENT_TRACK_REMOVED] room=${roomId} idx=${idx} id=${trackId}`);
      room.playlist.splice(idx, 1);
      room.updatedAt = Date.now();

      if (room.playlist.length === 0) {
        console.log(`[PLAYLIST][REMOVE_SUCCESS] room=${roomId} playlist now empty → clearing player state`);
        room.state.currentVideoId = null;
        room.state.currentTrackId = null;
        room.state.currentTrackIndex = -1;
        room.state.trackVersion = (room.state.trackVersion || 0) + 1;
        room.state.currentTime = 0;
        room.state.isPlaying = false;
        room.state.syncedAt = Date.now();
        room.state.lastTrackChangeAt = Date.now();
        room.updatedAt = Date.now();

        // Enter idle state when playlist becomes empty
        room.isIdle = true;

        io.to(roomId).emit('playlist-updated', room.playlist);
        io.to(roomId).emit('track-changed', buildTrackChangedPayload(room));
        io.to(roomId).emit('room-idle', { isIdle: true, playlistEnded: true });
        return;
      }

      let nextIdx = idx;
      if (nextIdx >= room.playlist.length) nextIdx = room.playlist.length - 1;
      const nextTrack = room.playlist[nextIdx];

      room.state.currentVideoId = nextTrack.id;
      room.state.currentTrackId = nextTrack.id;
      room.state.currentTrackIndex = nextIdx;
      room.state.trackVersion = (room.state.trackVersion || 0) + 1;
      room.state.currentTime = 0;
      room.state.isPlaying = true;
      room.state.syncedAt = Date.now();
      room.state.lastTrackChangeAt = Date.now();
      room.updatedAt = Date.now();

      io.to(roomId).emit('playlist-updated', room.playlist);
      io.to(roomId).emit('track-changed', buildTrackChangedPayload(room));
      return;
    }

    room.playlist.splice(idx, 1);
    room.updatedAt = Date.now();
    console.log(`[PLAYLIST][REMOVE_SUCCESS] room=${roomId} count=${room.playlist.length} ids=${room.playlist.map(v => v.id).join(',')}`);
    io.to(roomId).emit('playlist-updated', room.playlist);
  });

  // ── MOVE PLAYLIST ITEM ─────────────────────────────────────
  socket.on('move-playlist-item', ({ trackId, direction } = {}) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const user = room.members.get(socket.id)?.name || 'unknown';

    // Permission check: host or controller only
    const controllerIds = getControllerIds(room);
    const canControl = room.hostId === socket.id || controllerIds.includes(socket.id);
    if (!canControl) {
      console.log(`[PLAYLIST][MOVE][DENY] room=${roomId} socket=${socket.id} user=${user} trackId=${trackId} direction=${direction}`);
      return;
    }

    if (!Array.isArray(room.playlist) || !trackId || !['up', 'down'].includes(direction)) return;

    const currentIdx = getTrackIndex(room, trackId);
    if (currentIdx < 0) {
      console.log(`[PLAYLIST][MOVE][SKIP] room=${roomId} trackId=${trackId} not-found`);
      return;
    }

    const targetIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
    if (targetIdx < 0 || targetIdx >= room.playlist.length) {
      console.log(`[PLAYLIST][MOVE][SKIP] room=${roomId} currentIdx=${currentIdx} targetIdx=${targetIdx} out-of-bounds`);
      return;
    }

    console.log(`[PLAYLIST][MOVE_${direction.toUpperCase()}] room=${roomId} socket=${socket.id} user=${user} trackId=${trackId} from=${currentIdx} to=${targetIdx}`);

    // Swap items
    const [moved] = room.playlist.splice(currentIdx, 1);
    room.playlist.splice(targetIdx, 0, moved);
    room.updatedAt = Date.now();

    // Update currentTrackIndex to follow the moved track
    if (room.state.currentTrackIndex === currentIdx) {
      room.state.currentTrackIndex = targetIdx;
      console.log(`[PLAYLIST][INDEX_UPDATED] currentTrackIndex moved from ${currentIdx} to ${targetIdx}`);
    } else if (direction === 'up' && currentIdx < room.state.currentTrackIndex && targetIdx >= room.state.currentTrackIndex) {
      room.state.currentTrackIndex -= 1;
      console.log(`[PLAYLIST][INDEX_UPDATED] currentTrackIndex shifted down to ${room.state.currentTrackIndex}`);
    } else if (direction === 'down' && currentIdx > room.state.currentTrackIndex && targetIdx <= room.state.currentTrackIndex) {
      room.state.currentTrackIndex += 1;
      console.log(`[PLAYLIST][INDEX_UPDATED] currentTrackIndex shifted up to ${room.state.currentTrackIndex}`);
    }

    console.log(`[PLAYLIST][MOVE_SUCCESS] room=${roomId} count=${room.playlist.length} ids=${room.playlist.map(v => v.id).join(',')}`);
    io.to(roomId).emit('playlist-updated', room.playlist);
  });

  // ── TRACK CHANGE (authoritative) ─────────────────────────
  socket.on('request-track-change', ({ action, trackId, direction, currentTime, isPlaying } = {}) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const user = room.members.get(socket.id)?.name || 'unknown';

    // Host hoặc controller được thay đổi track
    const controllerIds = getControllerIds(room);
    const canControl = room.hostId === socket.id || controllerIds.includes(socket.id);
    if (!canControl) {
      console.log(`[TRACK][DENY] room=${roomId} socket=${socket.id} user=${user} action=${action}`);
      return;
    }

    // Track change lock: ignore if already changing
    if (room.state.isTrackChanging) {
      console.log(`[TRACK][LOCKED] room=${roomId} socket=${socket.id} user=${user} action=${action} isChanging=${room.state.isTrackChanging}`);
      return;
    }

    let nextIndex = room.state.currentTrackIndex;
    if (nextIndex < 0 && room.state.currentVideoId) {
      nextIndex = getTrackIndex(room, room.state.currentVideoId);
    }

    if (action === 'next' || direction === 1) nextIndex += 1;
    else if (action === 'prev' || direction === -1) nextIndex -= 1;
    else if (action === 'select') nextIndex = getTrackIndex(room, trackId);

    const nextTrack = room.playlist[nextIndex];
    console.log(`[TRACK][REQUEST] room=${roomId} socket=${socket.id} user=${user} action=${action} currentIndex=${room.state.currentTrackIndex} resolvedIndex=${nextIndex} currentVideo=${room.state.currentVideoId} targetVideo=${nextTrack?.id || trackId || null}`);

    if (!nextTrack) {
      console.log(`[TRACK][SKIP] room=${roomId} action=${action} reason=no_target_track`);
      // ── PLAYLIST ENDED ─────────────────────────────────────────────────
      // Playlist exhausted — enter idle state.
      // Room stays alive; socket/sync/chat/members continue as normal.
      if (!room.isIdle) {
        room.isIdle = true;
        room.state.currentVideoId = null;
        room.state.currentTrackId = null;
        room.state.currentTrackIndex = -1;
        room.state.isPlaying = false;
        room.state.currentTime = 0;
        room.state.trackVersion = (room.state.trackVersion || 0) + 1;
        room.state.syncedAt = Date.now();
        room.updatedAt = Date.now();
        console.log(`[PLAYLIST][ENDED] room=${roomId} → isIdle=true`);
        io.to(roomId).emit('room-idle', { isIdle: true, playlistEnded: true });
        io.to(roomId).emit('playlist-ended', { roomId, ended: true, currentVideoId: null });
      }
      return;
    }

    // Exiting idle when a new track is selected
    if (room.isIdle) {
      console.log(`[PLAYLIST][RECOVER] room=${roomId} exiting idle, playing track ${nextTrack.id}`);
      room.isIdle = false;
    }

    // Deduplication: nếu cùng track thì bỏ qua
    const duplicateTrack = room.state.currentVideoId === nextTrack.id && room.state.currentTrackIndex === nextIndex;
    if (duplicateTrack) {
      console.log(`[TRACK][SKIP] room=${roomId} action=${action} reason=duplicate_track`);
      return;
    }

    // Chống double next: nếu action là 'next' và chưa đủ 1.5s từ lần next trước thì bỏ qua
    // Điều này ngăn listener gọi next trùng khi video ended
    const isNextAction = (action === 'next' || direction === 1);
    if (isNextAction) {
      const timeSinceLastChange = Date.now() - (room.state.lastTrackChangeAt || 0);
      if (timeSinceLastChange < 1500) {
        console.log(`[TRACK][SKIP] room=${roomId} action=${action} reason=double_next_guard elapsed=${timeSinceLastChange}ms`);
        return;
      }
    }

    // Acquire track change lock
    room.state.isTrackChanging = true;
    room.state.lastTrackChangeRequestAt = Date.now();

    applyAuthoritativeTrackChange(room, nextTrack, nextIndex, {
      actionSource: action || 'select',
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      isPlaying: typeof isPlaying === 'boolean' ? isPlaying : true,
      actorSocketId: socket.id,
    });

    const payload = buildTrackChangedPayload(room);
    console.log(`[TRACK][BROADCAST] room=${roomId} version=${payload.trackVersion} index=${payload.currentTrackIndex} video=${payload.currentVideoId} action=${payload.lastActionSource} playing=${payload.isPlaying}`);

    // Gửi đến TẤT CẢ client trong room (bao gồm cả host sender)
    // Client tự phân biệt local vs remote action qua payload
    io.to(roomId).emit('track-changed', payload);

    // Release lock after 500ms
    setTimeout(() => {
      if (rooms.has(roomId)) {
        room.state.isTrackChanging = false;
      }
    }, 500);
  });

  // ── PLAYLIST ENDED (From Host Native End) ─────────────────
  socket.on('playlist-ended', (payload) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    // Permission check
    const controllerIds = getControllerIds(room);
    const canControl = room.hostId === socket.id || controllerIds.includes(socket.id);
    if (!canControl) return;

    console.log(`[PLAYLIST][ENDED_FROM_CLIENT] room=${roomId}`);
    
    // Update server state
    room.isIdle = true;
    room.state.currentVideoId = null;
    room.state.currentTrackId = null;
    room.state.currentTrackIndex = -1;
    room.state.isPlaying = false;
    room.state.currentTime = 0;
    room.state.trackVersion = (room.state.trackVersion || 0) + 1;
    room.state.syncedAt = Date.now();
    room.updatedAt = Date.now();

    // Broadcast
    io.to(roomId).emit('playlist-ended', payload);
    io.to(roomId).emit('room-idle', { isIdle: true, playlistEnded: true });
  });

  // ── VIDEO SYNC (same-track playback) ─────────────────────────────────
  // Host và controller đều được emit sync-video khi có action: play, pause, seek
  // Đây là AUTHORITY EVENTS - source of truth
  socket.on('sync-video', (videoState) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    // Kiểm tra quyền: host HOẶC controller
    const controllerIds = getControllerIds(room);
    const canControl = room.hostId === socket.id || controllerIds.includes(socket.id);
    if (!canControl) {
      console.log(`[SYNC][DENY] room=${roomId} socket=${socket.id} reason=no_control_permission`);
      return;
    }

    // Ignore stale sync: if the incoming sync is older than last syncedAt
    const incomingSyncedAt = videoState?.syncedAt || 0;
    if (incomingSyncedAt > 0 && incomingSyncedAt < room.state.syncedAt) {
      console.log(`[SYNC][STALE] room=${roomId} socket=${socket.id} incoming=${incomingSyncedAt} server=${room.state.syncedAt} ignored`);
      return;
    }

    console.log(`[SYNC][REQUEST] room=${roomId} socket=${socket.id} user=${room.members.get(socket.id)?.name || 'unknown'} currentVideo=${videoState?.currentVideoId} currentTime=${videoState?.currentTime} isPlaying=${videoState?.isPlaying} actionId=${room.state.lastActionId}`);

    // Bỏ qua nếu track không khớp
    if (videoState?.currentVideoId && room.state.currentVideoId && videoState.currentVideoId !== room.state.currentVideoId) {
      console.log(`[SYNC][IGNORE] room=${roomId} reason=track_mismatch incoming=${videoState.currentVideoId} authoritative=${room.state.currentVideoId}`);
      return;
    }

    // Check if this is a meaningful action (play/pause/seek) vs heartbeat
    const prevPlaying = room.state.isPlaying;
    const newPlaying = typeof videoState?.isPlaying === 'boolean' ? videoState.isPlaying : prevPlaying;
    const prevTime = room.state.currentTime || 0;
    const newTime = Number.isFinite(videoState?.currentTime) ? videoState.currentTime : prevTime;
    const timeDiff = Math.abs(newTime - prevTime);

    // Determine actionType: play, pause, seek, or heartbeat
    let actionType = 'heartbeat';
    if (prevPlaying !== newPlaying) {
      actionType = newPlaying ? 'play' : 'pause';
    } else if (timeDiff > 2) {
      actionType = 'seek';
    }

    // Meaningful action = play/pause state change OR seek > 2s
    const isMeaningfulAction = (prevPlaying !== newPlaying) || (timeDiff > 2);

    if (isMeaningfulAction) {
      // Increment action ID for meaningful events only
      room.state.lastActionId = (room.state.lastActionId || 0) + 1;

      // Store last authoritative action for multi-controller scenarios
      room.state.lastAuthoritativeAction = {
        actionId: room.state.lastActionId,
        actionType,
        actorSocketId: socket.id,
        timestamp: Date.now(),
        currentTime: newTime,
        isPlaying: newPlaying,
      };

      console.log(`[SYNC][MEANINGFUL_ACTION] room=${roomId} actionId=${room.state.lastActionId} type=${actionType} playing=${newPlaying} timeDiff=${timeDiff.toFixed(1)}s`);
    }

    room.state.currentVideoId = room.state.currentVideoId || videoState?.currentVideoId || null;
    room.state.currentTrackId = room.state.currentTrackId || room.state.currentVideoId;
    room.state.isPlaying = newPlaying;
    room.state.currentTime = newTime;
    room.state.syncedAt = Date.now();
    room.updatedAt = Date.now();
    console.log(`[SYNC][APPLIED] room=${roomId} socket=${socket.id} serverVideo=${room.state.currentVideoId} serverPlaying=${room.state.isPlaying} serverTime=${room.state.currentTime} actionId=${room.state.lastActionId}`);

    const payload = buildTrackChangedPayload(room);
    payload.lastActionId = room.state.lastActionId;
    payload.actionType = actionType;
    payload.actorSocketId = socket.id;
    console.log(`[SYNC][BROADCAST] room=${roomId} to=all currentVideo=${payload.currentVideoId} currentTime=${payload.currentTime} isPlaying=${payload.isPlaying} actionId=${payload.lastActionId} type=${actionType}`);

    // Gửi đến TẤT CẢ client trong room (bao gồm cả sender)
    io.to(roomId).emit('video-synced', payload);
  });

  // ── HEARTBEAT ─────────────────────────────────────────────
  // Heartbeat dùng để: room alive, server state persistence
  // KHÔNG dùng để chase playback liên tục
  socket.on('room-heartbeat', (payload) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    // Host hoặc controller được gửi heartbeat
    const controllerIds = getControllerIds(room);
    const canControl = room.hostId === socket.id || controllerIds.includes(socket.id);
    if (!canControl) {
      console.log(`[HEARTBEAT][DENY] room=${roomId} socket=${socket.id} hostId=${room.hostId}`);
      return;
    }

    // Support both old (number) and new (object) payload formats
    const time    = typeof payload === 'object' ? payload?.time    : payload;
    const isIdle  = typeof payload === 'object' ? payload?.isIdle  : false;

    console.log(`[HEARTBEAT][REQUEST] room=${roomId} socket=${socket.id} user=${room.members.get(socket.id)?.name || 'unknown'} currentVideo=${room.state.currentVideoId} time=${time} playing=${room.state.isPlaying} version=${room.state.trackVersion} actionId=${room.state.lastActionId} isIdle=${isIdle}`);

    // Update server-side state với timestamp
    room.state.currentTime = Number.isFinite(time) ? time : room.state.currentTime;
    room.state.syncedAt    = Date.now();
    room.updatedAt         = Date.now();

    // KHÔNG broadcast heartbeat thường xuyên nữa
    // Chỉ gửi khi: join, reconnect, host migration
    // Client tự playback mà không cần chase heartbeat
  });

  // ── OVERLAY RESYNC: guest requests authoritative state after re-enabling overlay ──
  socket.on('request-room-state', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    const payload = {
      currentVideoId:      room.state.currentVideoId,
      currentTrackId:      room.state.currentTrackId,
      currentTrackIndex:   room.state.currentTrackIndex,
      trackVersion:        room.state.trackVersion,
      isPlaying:           room.state.isPlaying,
      currentTime:         room.state.currentTime,
      syncedAt:            room.state.syncedAt,
      lastTrackChangeAt:   room.state.lastTrackChangeAt || 0,
      lastActionId:        room.state.lastActionId || 0,
      lastAuthoritativeAction: room.state.lastAuthoritativeAction || null,
      syncType: 'overlay_resync',
      forceHardSync: true,
    };

    console.log(`[SYNC][REQUEST_ROOM_STATE] room=${roomId} socket=${socket.id} → overlay_resync`);
    socket.emit('playback-state', payload);
  });

  // ── SERVER-SIDE PERIODIC SYNC (reconnect/stale recovery ONLY) ──────
  // TĂNG từ 15s lên 60s - chỉ dùng để:
  // - Room alive check
  // - Stale room recovery
  // - Host migration
  // KHÔNG dùng để chase playback liên tục
  setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      if (room.members.size < 1) continue;

      // Chỉ gửi periodic state cho reconnect recovery
      // KHÔNG force sync currentTime
      const payload = {
        currentVideoId: room.state.currentVideoId,
        currentTrackId: room.state.currentTrackId,
        currentTrackIndex: room.state.currentTrackIndex,
        trackVersion: room.state.trackVersion,
        isPlaying: room.state.isPlaying,
        // KHÔNG gửi currentTime - chỉ để reconnect recovery biết video nào
        currentTime: null, // null = không sync time
        syncedAt: now,
        lastTrackChangeAt: room.state.lastTrackChangeAt || 0,
        lastActionId: room.state.lastActionId || 0,
        lastAuthoritativeAction: room.state.lastAuthoritativeAction || null,
        isIdle: room.isIdle || false,
        syncType: 'periodic_recovery', // Chỉ dùng để recovery, không phải drift correction
      };

      io.to(roomId).emit('playback-state', payload);
      console.log(`[SYNC][PERIODIC_RECOVERY] room=${roomId} video=${payload.currentVideoId} playing=${payload.isPlaying} actionId=${payload.lastActionId} isIdle=${payload.isIdle}`);
    }
  }, 60000); // 60s - chỉ để keep alive và recovery

  // ── TOGGLE CONTROLLER (host only) ─────────────────────────
  socket.on('toggle-controller', ({ targetUserId }) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    // Chỉ host mới được cấp quyền
    if (room.hostId !== socket.id) {
      console.log(`[CONTROLLER][DENY] room=${roomId} socket=${socket.id} not_host`);
      socket.emit('room-error', '⚠️ Chỉ host mới có thể cấp quyền điều khiển.');
      return;
    }

    // Không thể cấp quyền cho chính mình (đã là host)
    if (targetUserId === socket.id) {
      console.log(`[CONTROLLER][DENY] room=${roomId} cannot grant_to_self`);
      socket.emit('room-error', '⚠️ Host đã có quyền điều khiển.');
      return;
    }

    const targetUser = room.members.get(targetUserId);
    if (!targetUser) {
      console.log(`[CONTROLLER][DENY] room=${roomId} target=${targetUserId} not_in_room`);
      return;
    }

    // Toggle controller
    const controllerIds = getControllerIds(room);
    const idx = controllerIds.indexOf(targetUserId);
    const isNowController = idx === -1;

    if (isNowController) {
      controllerIds.push(targetUserId);
      console.log(`[CONTROLLER_GRANTED] room=${roomId} target=${targetUser.name}(${targetUserId}) by=${socket.id}`);
    } else {
      controllerIds.splice(idx, 1);
      console.log(`[CONTROLLER_REMOVED] room=${roomId} target=${targetUser.name}(${targetUserId}) by=${socket.id}`);
    }
    console.log('[ROOM_CONTROLLER_IDS]', getControllerIds(room));

    room.updatedAt = Date.now();

    // Broadcast room state mới đến tất cả
    io.to(roomId).emit('room-state-updated', {
      hostId:        room.hostId,
      controllerIds: room.state.controllerIds
    });
  });

  // ── REACTIONS ─────────────────────────────────────────────
  socket.on('send-reaction', (emoji) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    console.log(`[REACTION] room=${roomId} socket=${socket.id} user=${room.members.get(socket.id)?.name || 'unknown'} emoji=${emoji}`);
    io.to(roomId).emit('reaction-received', { id: socket.id, emoji });
  });

  // ── CHAT ──────────────────────────────────────────────────
  socket.on('chat-msg', (text) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const name = rooms.get(roomId).members.get(socket.id)?.name || 'Guest';
    const avatar = rooms.get(roomId).members.get(socket.id)?.avatar || '';
    console.log(`[CHAT] room=${roomId} socket=${socket.id} user=${name} text=${sanitizeText(text, 80)}`);
    io.to(roomId).emit('chat-msg', {
      senderId:  socket.id,
      name,
      avatar,
      text:      sanitizeText(text, 300),
      timestamp: Date.now()
    });
  });

  // ── PROFILE UPDATE ──────────────────────────────────────
  // When a user updates their profile (from Room Hub or room), broadcast to all.
  socket.on('profile-update', (payload) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    const profileNickname = payload?.nickname ? sanitizeText(payload.nickname, 30) : '';
    const profileAvatar   = typeof payload?.avatar === 'string' && payload.avatar.length > 0 ? payload.avatar : '';

    // Update member record
    const member = room.members.get(socket.id);
    if (member) {
      if (profileNickname) member.name = profileNickname;
      if (profileAvatar)   member.avatar = profileAvatar;
      console.log(`[PROFILE_UPDATE] room=${roomId} socket=${socket.id} name=${profileNickname} avatar=${profileAvatar}`);
    }

    // Broadcast to all clients in the room
    io.to(roomId).emit('profile-updated', {
      id:      socket.id,
      name:    profileNickname,
      avatar:  profileAvatar,
      clientId: payload?.clientId || member?.clientId || null,
    });
  });
  socket.on('disconnect', (reason) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) {
      console.log(`[socket] disconnected id=${socket.id} reason=${reason} room=none`);
      return;
    }

    const room = rooms.get(roomId);
    const user = room.members.get(socket.id)?.name || 'unknown';
    const wasHost = room.hostId === socket.id;
    const wasController = room.state.controllerIds?.includes(socket.id);
    room.members.delete(socket.id);
    console.log(`[socket] disconnected id=${socket.id} reason=${reason} room=${roomId} user=${user} wasHost=${wasHost} remainingMembers=${room.members.size}`);

    // Remove from controller list if was controller
    if (wasController && room.state.controllerIds) {
      room.state.controllerIds = room.state.controllerIds.filter(id => id !== socket.id);
    }

    if (room.members.size === 0) {
      // Cancel any pending grace period
      if (hostDisconnectTimers.has(roomId)) {
        clearTimeout(hostDisconnectTimers.get(roomId).timer);
        hostDisconnectTimers.delete(roomId);
      }
      rooms.delete(roomId);
      console.log(`[room] empty-deleted id=${roomId} activeRooms=${rooms.size}`);
    } else if (wasHost) {
      // Host disconnected: start grace period, don't close yet
      console.log(`[DISCONNECT][HOST] room=${roomId} socket=${socket.id} starting grace period (${HOST_RECONNECT_GRACE_MS}ms) wasTrackChanging=${room.state.isTrackChanging} currentVideo=${room.state.currentVideoId} playing=${room.state.isPlaying}`);
      console.log(`[HOST_RECLAIM][GRACE_START] room=${roomId} graceMs=${HOST_RECONNECT_GRACE_MS} currentVideo=${room.state.currentVideoId}`);
      
      // Cancel any existing grace period timer
      if (hostDisconnectTimers.has(roomId)) {
        clearTimeout(hostDisconnectTimers.get(roomId).timer);
      }
      
      // Set new grace period timer
      const timer = setTimeout(() => {
        // Grace period expired: promote new host or close room
        if (!rooms.has(roomId)) return; // Room already closed
        
        const currentRoom = rooms.get(roomId);
        
        // Verify the candidate is still connected (socket still exists)
        const newHostId = currentRoom.members.keys().next().value;
        const socketStillConnected = io.sockets.sockets.has(newHostId);
        
        console.log(`[DISCONNECT][HOST_GRACE_EXPIRED] room=${roomId} candidate=${newHostId} socketOnline=${socketStillConnected}`);
        
        if (!socketStillConnected) {
          // The candidate is already disconnected, close room to avoid orphan state
          console.log(`[DISCONNECT][HOST_GRACE_EXPIRED] candidate disconnected, closing room`);
          closeRoom(roomId, 'no_online_host');
          return;
        }
        
        if (currentRoom.members.size === 0) {
          closeRoom(roomId, 'empty');
        } else {
          // Promote member to host
          const newHostName = currentRoom.members.get(newHostId)?.name || 'unknown';
          const oldHostToken = currentRoom.hostToken;
          
          // Reset all controller permissions - new host has full control
          const oldControllers = currentRoom.state.controllerIds || [];
          currentRoom.state.controllerIds = [];
          
          currentRoom.hostId = newHostId;
          currentRoom.hostToken = Math.random().toString(36).substring(2, 15);
          currentRoom.updatedAt = Date.now();
          
          console.log(`[DISCONNECT][HOST_GRACE_EXPIRED] room=${roomId} oldHost=${socket.id} newHost=${newHostId}(${newHostName}) resetControllers=${oldControllers.join(',')}`);
          io.to(roomId).emit('host-changed', {
            newHostId,
            newHostName,
            newHostToken: currentRoom.hostToken,
            oldHostToken,
            resetControllers: true,
          });
        }
        
        hostDisconnectTimers.delete(roomId);
      }, HOST_RECONNECT_GRACE_MS);
      
      hostDisconnectTimers.set(roomId, { disconnectedAt: Date.now(), timer });
      
    } else {
      console.log(`[DISCONNECT][BROADCAST] room=${roomId} event=member-left socket=${socket.id}`);
      io.to(roomId).emit('member-left', socket.id);
    }
  });
});

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses  = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  return addresses;
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n=== 🚀 MidnightMusic Server RUNNING ===`);
  console.log(`* Local:   http://localhost:${PORT}`);
  console.log(`* CORS origins allowed: ${ALLOWED_ORIGINS.length}`);
  const lanIps = getLocalIpAddresses();
  lanIps.forEach(ip => console.log(`* Network: http://${ip}:${PORT}`));
  console.log(`======================================\n`);
});
