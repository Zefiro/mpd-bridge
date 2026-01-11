// Connects to a Lyrion server (LMS, Logitech Music Server) for controlling the clients

const winston = require('winston')
const net = require('net')
const EventEmitter = require('events');

class LmsClient extends EventEmitter {    

  constructor(config, logger) {
    super();
    this.config = config
    this.logger = logger

    this._socket = null;
    this._buffer = '';
    this._connecting = false;
    this._backoffMs = 1000;
    this._maxBackoffMs = 30000;
    this._reconnectTimer = null;
  }

  async connect() {
    // start CLI connection and JSON-RPC is just on-demand (no persistent HTTP)
    this._startCli();
  }

  async disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
  }

  // ---------- JSON-RPC helpers ----------

  async _rpc(params) {
    const body = JSON.stringify({
      id: 1,
      method: 'slim.request',
      params,
    });

    const url = `http://${this.config.host}:${this.config.httpPort}/jsonrpc.js`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      throw new Error(`LMS JSON-RPC HTTP ${res.status}`);
    }

    const json = await res.json();
    this.logger.silly("rpc: json=%o", json)
    if (!json.result) {
      throw new Error('LMS JSON-RPC returned no result');
    }

    return json.result;
  }

  // Snapshot: all players
/* Example player output:
{
  id: '00:00:00:00:00:00',
  name: 'Main Lair',
  ip: '10.20.30.41:42658',
  model: 'squeezelite',
  modelName: 'SqueezeLite',
  power: true,
  isPlaying: true,
  connected: true
}
*/
  async getPlayers() {
    // Ask for up to 50 players explicitly (API claims I don't need to give a limit, but this didn't return anything for me)
    const result = await this._rpc(['', ['players', '0', '50']]);
    // result.players_loop is typical structure used in JSON-RPC.[web:21]
    const players = result.players_loop || [];
    return players
    // perplexity suggested this mapping:
/*
    return players.map(p => ({
      id: p.playerid,
      name: p.name,
      ip: p.ip,
      model: p.model,
      modelName: p.modelname,
      power: p.power === 1 || p.power === '1',
      // some LMS versions expose isplaying in this block, some only in status
      isPlaying: p.isplaying === 1 || p.isplaying === '1',
      connected: p.connected === 1 || p.connected === '1',
    }));
*/
  }

// Snapshot: one player status (mode, volume, track...)
/* Example raw json:
{
    player_name: 'Main Lair',
    player_connected: 1,
    player_ip: '10.20.30.41:42658',
    power: 1,
    signalstrength: 0,
    mode: 'play',
    remote: 1,
    current_title: '239 Kevin Cornine - EOYC 2025 on AH.FM',
    time: 9523.88817513657,
    rate: 1,
    'mixer volume': 36,
    'playlist repeat': 0,
    'playlist shuffle': 0,
    'playlist mode': 'off',
    seq_no: 0,
    playlist_cur_index: '0',
    playlist_timestamp: 1766445201.23629,
    playlist_tracks: 1,
    randomplay: 0,
    digital_volume_control: 1,
    use_volume_control: 1,
    remoteMeta: {
      id: '-100777383289248',
      title: 'EOYC 2025 on AH.FM',
      artist: '239 Kevin Cornine',
      coverid: '-100777383289248',
      artwork_url: '/imageproxy/https%3A%2F%2Fstation-images-prod.radio-assets.com%2F100%2Fahfm-afterhours-fm.png%3Fversion%3D8c7586725d24e94a8c2ce4a837416208566459d6/image.png',
      remote_title: 'AH.FM Afterhours FM (Toronto, Canada / Electro, Trance)'
    },
    playlist_loop: [
      {
        title: 'EOYC 2025 on AH.FM',
        coverid: '-100777383289248',
        'playlist index': 0,
        remote_title: 'AH.FM Afterhours FM (Toronto, Canada / Electro, Trance)',
        id: '-100777383289248',
        artist: '239 Kevin Cornine',
        artwork_url: '/imageproxy/https%3A%2F%2Fstation-images-prod.radio-assets.com%2F100%2Fahfm-afterhours-fm.png%3Fversion%3D8c7586725d24e94a8c2ce4a837416208566459d6/image.png'
      },
      [length]: 1
    ]
  }
* Example status output:
{
  playerId: '00:00:00:00:00:00',
  mode: 'play',
  power: true,
  volume: 36,
  title: '239 Kevin Cornine - EOYC 2025 on AH.FM',
  artist: undefined,
  album: undefined,
  playlistIndex: 0,
  playlistTracks: 1
}
*/
  async getPlayerStatus(playerId) {
    // status - 1 tags:aclKN[web:21]
    const result = await this._rpc([
      playerId,
      ['status', '-', '1', 'tags:aclKN'],
    ]);

    return result
    // Perplexity suggested this mapping:
/*
    {
      playerId,
      mode: result.mode,                    // 'play' | 'pause' | 'stop'
      power: result.power === 1 || result.power === '1',
      volume: Number(result['mixer volume']),
      title: result.current_title || (result.playlist_loop && result.playlist_loop[0]?.title),
      artist: result.artist,
      album: result.album,
      playlistIndex: Number(result['playlist_cur_index']),
      playlistTracks: Number(result.playlist_tracks),
    };
*/
  }

  async setVolume(playerId, volume) {
    await this._rpc([playerId, ['mixer', 'volume', String(volume)]]);
  }

  async changeVolume(playerId, delta) {
    // relative volume: '+5' or '-5'
    const val = delta >= 0 ? `+${delta}` : String(delta);
    await this._rpc([playerId, ['mixer', 'volume', val]]);
  }

  async setMute(playerId, mute) {
    await this._rpc([playerId, ['mixer', 'muting', mute ? '1' : '0']]);
  }

  async play(playerId) {
    await this._rpc([playerId, ['play']]);
  }

  async pause(playerId, on = true) {
    await this._rpc([playerId, ['pause', on ? '1' : '0']]);
  }

  async togglePause(playerId) {
    await this._rpc([playerId, ['pause']]);
  }

  async stop(playerId) {
    await this._rpc([playerId, ['stop']]);
  }

  async setPower(playerId, on) {
    await this._rpc([playerId, ['power', on ? '1' : '0']]);
  }

  async refreshAllStatus() {
    this.logger.debug("refreshAllStatus: getting players")
    const players = await this.getPlayers();
    this.logger.info("Found %d clients:%s", players.length, players.map(p => "\n#" + p.playerindex + ": name='" + p.name + "' (id=" + p.playerid + ", ip=" + p.ip + ") - " + p.modelname + " (" + p.model + ")").join(''))
    for (const p of players) {
      this.logger.debug("refreshAllStatus: getting status for player %s", p.name)
      const playerStatus = await this.getPlayerStatus(p.playerid);
      this.emit('playerStatus', { playerId: p.playerid, playerStatus });
    }
  }

  // ---------- CLI connection & notifications ----------

  _startCli() {
    if (this._connecting || this._socket) return
    this._connecting = true

    const socket = new net.Socket()
    this._socket = socket
    this._buffer = ''

    socket.setEncoding('utf8');

    socket.on('connect', () => {
      this.logger.info("LMS CLI Connected")
      this._connecting = false
      this._backoffMs = 1000 // reset backoff
      this.emit('connected')

      // optional login
      if (this.config.username && this.config.password) {
        socket.write(`login ${encodeURIComponent(this.config.username)} ${encodeURIComponent(this.config.password)}\n`)
      }

      // enable all notifications
      socket.write('listen 1\n')

      this.refreshAllStatus().catch(err =>
            this.logger.error('LMS initial status failed: %o', err)
          )
    })

    socket.on('data', async chunk => {
      this._buffer += chunk;
      let idx;
      while ((idx = this._buffer.indexOf('\n')) >= 0) {
        const line = this._buffer.slice(0, idx).trim();
        this._buffer = this._buffer.slice(idx + 1);
        if (line) await this._handleRawLine(line);
      }
    });

    socket.on('error', err => {
      this.emit('error', err);
    });

    socket.on('close', () => {
      this._socket = null;
      this._connecting = false;
      this.emit('disconnected');
      this.logger.warn('LMS CLI disconnected (will retry)');
      this._scheduleReconnect();
    });

    socket.connect(this.config.cliPort, this.config.host);
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) {
        this.logger.debug("scheduleReconnect: reconnectTimer already running")
        return;
    }
    const delay = this._backoffMs;
    this._backoffMs = Math.min(this._backoffMs * 2, this._maxBackoffMs);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._startCli();
    }, delay);
    this.logger.debug("scheduleReconnect in %f sec", delay/1000)
  }

  _handleRawLine(line) {
    this.logger.silly("Incoming data: %o", line)
    if (!line.length) return
    const rawParts = line.split(' ')
    const parts = rawParts.map(p => {
        try {
          return decodeURIComponent(p)
        } catch {
          return p // ignore if LMS ever sends malformed encoding
        }
    })

    const playerId = parts[0].includes(':') ? parts[0] : null

    this.emit('data', { playerId, parts, line })
  }

// TODO move to things.js
  async _handleCliLine(line) {
    // CLI notifications look like:
    // "<playerid> mixer volume 25"
    // "<playerid> playlist newsong Title%20Here 8"
    // "<playerid> playlist pause 1"
    // "<playerid> playlist stop"
    // "<playerid> client new"
    // "library changed 1"
    // "rescan done"
    // etc.[web:13][web:6]
    this.logger.silly("Incoming data: %o", line)
    
    if (!line.length) return
    const rawParts = line.split(' ')
    const parts = rawParts.map(p => {
        try {
          return decodeURIComponent(p)
        } catch {
          return p // ignore if LMS ever sends malformed encoding
        }
    })
    

    if (parts[0].includes(':')) {
      // likely starts with playerid
      const playerId = parts[0];
      const cmd = parts[1];

      if (cmd === 'mixer' && parts[2] === 'volume') {
        const volStr = parts[3];
        const volume = Number(volStr);
        this.emit('playerVolume', { playerId, volume, raw: line });
        return;
      }

      if (cmd === 'mixer' && parts[2] === 'muting') {
        const val = parts[3];
        const muted = val === '1';
        this.emit('playerMute', { playerId, muted, raw: line });
        return;
      }

      if (cmd === 'playlist') {
        const sub = parts[2];

        if (sub === 'newsong') {
          const title = parts[3] || '';
          const idx = parts[4] ? Number(parts[4]) : undefined;
          this.emit('playerTrack', { playerId, title, playlistIndex: idx, raw: line });
          this.emit('playerPlayState', { playerId, mode: 'play', raw: line }); // assume playing
          return;
        }


        if (sub === 'pause') {
          const val = parts[3];
          const mode = val === '1' ? 'pause' : 'play';
          this.emit('playerPlayState', { playerId, mode, raw: line });
          return;
        }

        if (sub === 'stop') {
          this.emit('playerPlayState', { playerId, mode: 'stop', raw: line });
          return;
        }
      }

      if (cmd === 'client') {
        const sub = parts[2];
        if (sub === 'new') {
          this.emit('playerClient', { playerId, state: 'new', raw: line });
          const status = await this.getPlayerStatus(playerId);
          this.emit('playerStatus', status);
          return;
        }
        if (sub === 'disconnect') {
          this.emit('playerClient', { playerId, state: 'disconnect', raw: line });
          return;
        }
        if (sub === 'reconnect') {
          this.emit('playerClient', { playerId, state: 'reconnect', raw: line });
          return;
        }
      }

      // fallback: emit raw line per player
      this.emit('playerNotification', { playerId, line });
    } else {
      // global notifications like "rescan done", "favorites changed", "library changed 1"[web:13]
      const cmd = parts[0];
      if (cmd === 'rescan' && parts[1] === 'done') {
        this.emit('rescanDone');
        return;
      }
      if (cmd === 'favorites' && parts[1] === 'changed') {
        this.emit('favoritesChanged');
        return;
      }
      if (cmd === 'library' && parts[1] === 'changed') {
        const val = parts[2];
        this.emit('libraryChanged', { present: val === '1' });
        return;
      }

      this.emit('serverNotification', { line });
    }
  }
}


/* TODO ponder whether to directly expose the class (and change the constructor, and how it's called)
here:
  module.exports = { LmsClient };
grag.js:
  const { LmsClient } = require('./lms-client');
  new LmsClient(...)
*/ 


module.exports = function(god, loggerName = 'lms') {
	var self = {
		lms: undefined, 
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.preterminateListeners.push(this.onPreTerminate.bind(this))
		god.terminateListeners.push(this.onTerminate.bind(this))
        this.lms = new LmsClient(god.config.lmsConfig, this.logger)
	},
    
	onPreTerminate: async function() {
	},

	onTerminate: async function() {
	},
    
    on: function(a, b) {
        this.lms.on(a, b)
    },
    
    connect: async function() {
        return this.lms.connect()
    },

    refreshAllStatus: async function() {
        return this.lms.refreshAllStatus()
    },

}
    self.init()
    return self
}
