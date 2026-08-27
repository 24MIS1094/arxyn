export type AudioSourceType = 'youtube' | 'youtube_music' | 'amazon_music' | 'device_file' | 'arxyn_library' | 'future_service';

export interface AudioTrack {
  mediaId: string;
  sourceType: AudioSourceType;
  title: string;
  artist: string;
  artwork?: string;
  durationMs?: number;
  sourceOwnerId?: string;
}

export interface AudioSourceAdapter {
  readonly type: AudioSourceType;
  readonly label: string;
  search(query: string): Promise<AudioTrack[]>;
  canPlay(track: AudioTrack): boolean;
}

export interface NativeAudioCaptureBridge {
  isAvailable(): Promise<boolean>;
  prepareAuthorizedSource(mediaId: string): Promise<void>;
}
