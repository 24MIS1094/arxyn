import type { AudioSourceAdapter, AudioSourceType, AudioTrack, NativeAudioCaptureBridge } from './types';

const unavailable = (type: AudioSourceType, label: string): AudioSourceAdapter => ({
  type,
  label,
  async search() {
    return [];
  },
  canPlay() {
    return false;
  },
});

export class YouTubeAdapter implements AudioSourceAdapter {
  readonly type = 'youtube' as const;
  readonly label = 'YouTube';
  async search(_query: string) { return []; }
  canPlay(_track: AudioTrack) { return false; }
}

export const YouTubeMusicAdapter = unavailable('youtube_music', 'YouTube Music');
export const AmazonMusicAdapter = unavailable('amazon_music', 'Amazon Music');
export const ArxynLibraryAdapter = unavailable('arxyn_library', 'ARXYN Library');

export const DeviceFileAdapter: AudioSourceAdapter = {
  type: 'device_file',
  label: 'Device Files',
  async search() { return []; },
  canPlay(track) { return track.sourceType === 'device_file'; },
};

export class AudioSourceManager {
  constructor(
    private readonly adapters: AudioSourceAdapter[],
    private readonly nativeBridge?: NativeAudioCaptureBridge,
  ) {}

  get availableSources() { return this.adapters; }

  async search(type: AudioSourceType, query: string) {
    const adapter = this.adapters.find((item) => item.type === type);
    return adapter ? adapter.search(query) : [];
  }

  async prepare(track: AudioTrack) {
    const adapter = this.adapters.find((item) => item.type === track.sourceType);
    if (!adapter?.canPlay(track)) {
      return { supported: false, reason: 'Direct synchronized playback is not available for this source on this platform.' };
    }
    if (this.nativeBridge) await this.nativeBridge.prepareAuthorizedSource(track.mediaId);
    return { supported: true };
  }
}
