/**
 * AudioManager — background music + sound effects with independent mute toggles.
 *
 * No audio files ship yet; the manager is wired and ready. Once tracks are added
 * under `public/audio/`, call `setMusic('/audio/…')` and `playSfx('/audio/…')`.
 * Both channels can be muted independently and the choice is persisted.
 */

const LS_MUSIC = 'td.muteMusic';
const LS_SFX = 'td.muteSfx';

export class AudioManager {
  private musicMuted: boolean;
  private sfxMuted: boolean;
  private music: HTMLAudioElement | null = null;

  constructor() {
    this.musicMuted = readFlag(LS_MUSIC);
    this.sfxMuted = readFlag(LS_SFX);
  }

  isMusicMuted(): boolean {
    return this.musicMuted;
  }
  isSfxMuted(): boolean {
    return this.sfxMuted;
  }

  /** Toggle music mute; returns the new muted state. */
  toggleMusic(): boolean {
    this.musicMuted = !this.musicMuted;
    writeFlag(LS_MUSIC, this.musicMuted);
    if (this.music) {
      this.music.muted = this.musicMuted;
      if (!this.musicMuted) void this.music.play().catch(() => {});
    }
    return this.musicMuted;
  }

  /** Toggle sound-effect mute; returns the new muted state. */
  toggleSfx(): boolean {
    this.sfxMuted = !this.sfxMuted;
    writeFlag(LS_SFX, this.sfxMuted);
    return this.sfxMuted;
  }

  /** Set (and start, if unmuted) the looping background music track. */
  setMusic(src: string, volume = 0.5): void {
    if (!this.music) {
      this.music = new Audio();
      this.music.loop = true;
    }
    this.music.volume = volume;
    if (!this.music.src.endsWith(src)) this.music.src = src;
    this.music.muted = this.musicMuted;
    if (!this.musicMuted) void this.music.play().catch(() => {});
  }

  /** Play a one-shot sound effect (no-op while muted). */
  playSfx(src: string, volume = 0.6): void {
    if (this.sfxMuted) return;
    const a = new Audio(src);
    a.volume = volume;
    void a.play().catch(() => {});
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignore storage errors (private mode, etc.) */
  }
}
