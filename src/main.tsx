import React, { type ChangeEvent, type FormEvent, Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, ArrowUpRight, Check, Copy, Home as HomeIcon, LoaderCircle, LogOut, Menu, Music2, Pause, Play, Plus, Radio, Search, Settings, Share2, SkipBack, SkipForward, Users, X, Volume2 } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import ReactPlayer from 'react-player';
import './index.css';

type View = 'home' | 'rooms' | 'profile' | 'settings' | 'room' | 'browse' | 'search' | 'library' | 'playlists' | 'downloads' | 'connected';

type Room = {
  id: string;
  name: string;
  description: string | null;
  code: string;
  max_participants: number;
  host_id: string;
  visibility: string;
  created_at?: string;
  updated_at?: string;
};

type QueueItem = {
  id: string;
  room_id: string;
  media_id: string;
  title: string;
  artist: string | null;
  artwork_url: string | null;
  position: number;
  duration_ms: number | null;
  source_type: string | null;
  created_at: string;
  requested_by?: string | null;
};

type PlaybackState = {
  room_id: string;
  media_id: string | null;
  title: string | null;
  artist: string | null;
  artwork_url: string | null;
  is_playing: boolean;
  position_ms: number;
  server_timestamp: string;
  updated_at: string;
  sequence_number: number;
};

type Member = {
  user_id: string;
  role: string | null;
  joined_at: string;
  display_name: string;
};

type PresenceUser = {
  user_id: string;
  display_name: string;
  joined_at: number;
  is_host: boolean;
};

const safeSeek = (player: any, seconds: number) => {
  if (!player) return;
  if (typeof player.seekTo === 'function') {
    player.seekTo(seconds, 'seconds');
  } else if (player.getInternalPlayer && typeof player.getInternalPlayer === 'function') {
    const internal = player.getInternalPlayer();
    if (internal && typeof internal.seekTo === 'function') {
      internal.seekTo(seconds);
    }
  } else {
    console.warn('ReactPlayer: seekTo method not available', player);
  }
};

const safeGetCurrentTime = (player: any): number | undefined => {
  if (!player) return undefined;
  if (typeof player.getCurrentTime === 'function') {
    return player.getCurrentTime();
  }
  if (player.getInternalPlayer && typeof player.getInternalPlayer === 'function') {
    const internal = player.getInternalPlayer();
    if (internal && typeof internal.getCurrentTime === 'function') {
      return internal.getCurrentTime();
    }
  }
  console.warn('ReactPlayer: getCurrentTime method not available', player);
  return undefined;
};

const authConfigError = 'Authentication is not configured for this deployment. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the Vercel project environment.';
const appBaseUrl = (import.meta.env.VITE_SITE_URL || import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')).replace(/\/$/, '');
const googleAuthRedirectUrl = new URL('/auth/callback', `${appBaseUrl}/`).toString();
const getAuthRedirectUrl = (path: string) => new URL(path, `${appBaseUrl}/`).toString();
const getRoomIdFromLocation = (pathname: string, search: string) => {
  const match = pathname.match(/^\/room\/([^/]+)\/?$/);
  if (match) return decodeURIComponent(match[1]);
  const roomId = new URLSearchParams(search).get('room');
  return roomId?.trim() || null;
};
const getRoomUrl = (id: string) => `${window.location.origin}/room/${encodeURIComponent(id)}`;
const gradient = 'linear-gradient(135deg, rgba(137, 168, 255, 0.24), rgba(255, 128, 102, 0.2) 40%, rgba(122, 89, 255, 0.18));';
const audioBucket = 'room-audio';
const legacyAudioBucket = 'audio';
const getAudioBucketCandidates = () => [audioBucket, legacyAudioBucket].filter((bucket, index, buckets) => buckets.indexOf(bucket) === index);
const allowedAudioMimeTypes = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm']);
const allowedAudioExtensions = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'webm']);

type SupabaseErrorLike = {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
};

const logSupabaseError = (table: string, operation: string, error: SupabaseErrorLike) => {
  console.error('Supabase error', {
    table,
    operation,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
};

const roomSelectColumns = 'id, name, description, code, host_id, max_participants, visibility, created_at';

const generateRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'A');

const formatTime = (valueMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const getPublicStorageUrl = (path: string, preferredBucket: string = audioBucket) => {
  if (!supabase) return path;
  if (!path || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) return path;

  for (const bucketName of [preferredBucket, ...getAudioBucketCandidates().filter((bucket) => bucket !== preferredBucket)]) {
    try {
      const { data } = supabase.storage.from(bucketName).getPublicUrl(path);
      if (data?.publicUrl) {
        return data.publicUrl;
      }
    } catch (error) {
      console.warn(`Unable to resolve public storage URL from bucket "${bucketName}"`, error);
    }
  }

  return path;
};

const getQueueAudioUrl = (item: Pick<QueueItem, 'media_id' | 'source_type'> | null | undefined) => {
  if (!item?.media_id) return '';
  const storagePath = item.media_id.trim();
  if (!storagePath) return '';
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://') || storagePath.startsWith('blob:')) return storagePath;
  return getPublicStorageUrl(storagePath, audioBucket);
};

const getExpectedPlaybackPosition = (state: PlaybackState | null, localReceiveTime?: number) => {
  if (!state) return 0;
  const positionMs = Number(state.position_ms ?? 0);
  
  if (!state.is_playing) return positionMs / 1000;

  if (localReceiveTime) {
    const elapsedSeconds = (Date.now() - localReceiveTime) / 1000;
    return Math.max(0, positionMs / 1000 + elapsedSeconds);
  }

  const timestampMs = Date.parse(state.server_timestamp ?? new Date().toISOString());
  if (!Number.isFinite(timestampMs)) return positionMs / 1000;
  
  const elapsedSeconds = (Date.now() - timestampMs) / 1000;
  return Math.max(0, positionMs / 1000 + elapsedSeconds);
};

const getSafeAudioFileName = (fileName: string) => {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'audio'}` : '.audio';
  const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'audio';
  return `${baseName}${extension}`;
};

const isAudioFile = (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return allowedAudioMimeTypes.has(file.type) || file.type.startsWith('audio/') || allowedAudioExtensions.has(extension);
};

const joinRoom = async (roomId: string) => {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data: authUser, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authUser.user) throw new Error('AUTH_REQUIRED');

  const { data, error } = await supabase.rpc('join_room', {
    p_room_id: roomId,
  });

  if (error) {
    console.error('JOIN ROOM RPC ERROR:', error);
    console.error('ROOM ID:', roomId);
    console.error('ERROR MESSAGE:', error.message);
    console.error('ERROR DETAILS:', error.details);
    console.error('ERROR HINT:', error.hint);
    console.error('ERROR CODE:', error.code);

    throw new Error(`Unable to join room: ${error.message || 'Unknown error'}`);
  }

  if (data !== true) {
    throw new Error('Unable to join room: The join operation was not confirmed.');
  }

  return data;
};

const getDisplayRoomName = (room: Room) => room.name || 'Untitled room';

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ARXYN app render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="intro-screen">
          <div className="intro-logo">
            <span className="brand-mark"><Radio size={20} /></span>
            <strong>AR<span className="logo-x">X</span>YN</strong>
          </div>
          <p>One Sound. Everyone.</p>
          <div className="form-error" style={{ maxWidth: 560, marginTop: 18 }}>
            <AlertCircle size={15} />
            ARXYN could not load correctly. Please refresh or check the app configuration.
            <br />
            {this.state.error.message}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [intro, setIntro] = useState(true);
  const initialRoomId = getRoomIdFromLocation(window.location.pathname, window.location.search);
  const [view, setView] = useState<View>(initialRoomId ? 'room' : 'home');
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [toast, setToast] = useState('');
  const [dark, setDark] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 700);

    const initialise = async () => {
      try {
        if (!supabase) {
          setReady(true);
          setInitError(authConfigError);
          return;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Supabase session initialization error:', error);
          setInitError(error.message);
        }
        setSession(data.session);
        const pendingRoomId = sessionStorage.getItem('arxyn_pending_room_id');
        if (data.session && pendingRoomId) {
          setRoomId(pendingRoomId);
          setView('room');
          window.history.replaceState({}, '', `/room/${encodeURIComponent(pendingRoomId)}`);
          sessionStorage.removeItem('arxyn_pending_room_id');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected authentication initialization error';
        console.error('ARXYN auth bootstrap failed:', error);
        setInitError(message);
      } finally {
        setReady(true);
      }
    };

    void initialise();

    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
        const pendingRoomId = sessionStorage.getItem('arxyn_pending_room_id');
        if (next && pendingRoomId) {
          setRoomId(pendingRoomId);
          setView('room');
          window.history.replaceState({}, '', `/room/${encodeURIComponent(pendingRoomId)}`);
          sessionStorage.removeItem('arxyn_pending_room_id');
        }
      });
      return () => {
        window.clearTimeout(timer);
        data.subscription.unsubscribe();
      };
    }

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const pendingRoomId = getRoomIdFromLocation(window.location.pathname, window.location.search);
    if (!session && pendingRoomId) {
      sessionStorage.setItem('arxyn_pending_room_id', pendingRoomId);
    }
  }, [session]);

  useEffect(() => {
    const handlePopState = () => {
      const nextRoomId = getRoomIdFromLocation(window.location.pathname, window.location.search);
      setRoomId(nextRoomId);
      setView(nextRoomId ? 'room' : 'home');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };

  const openRoom = (id: string) => {
    setRoomId(id);
    setView('room');
    window.history.pushState({}, '', `/room/${id}`);
  };

  const logout = async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setView('home');
    setRoomId(null);
    window.history.pushState({}, '', '/');
  };

  if (intro) return <Intro />;
  if (!ready) return <Loading text="Restoring your session" />;
  if (!session) return <Auth initError={initError} />;

  return (
    <Shell
      session={session}
      view={view}
      setView={setView}
      roomId={roomId}
      openRoom={openRoom}
      modal={modal}
      setModal={setModal}
      dark={dark}
      setDark={setDark}
      logout={logout}
      notify={notify}
      toast={toast}
      onRoomDeleted={() => { setRoomId(null); setView('home'); window.history.pushState({}, '', '/'); }}
    />
  );
}

function Intro() {
  return (
    <div className="intro-screen">
      <div className="intro-logo">
        <span className="brand-mark"><Radio size={20} /></span>
        <strong>AR<span className="logo-x">X</span>YN</strong>
      </div>
      <p>One Sound. Everyone.</p>
      <div className="intro-wave" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </div>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="intro-screen">
      <div className="intro-logo">
        <span className="brand-mark"><Radio size={20} /></span>
        <strong>AR<span className="logo-x">X</span>YN</strong>
      </div>
      <p>One Sound. Everyone.</p>
      <LoaderCircle className="spin" size={20} />
      <small>{text}</small>
    </div>
  );
}

function Auth({ initError }: { initError?: string | null }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const callbackError = params.get('error_description') || new URLSearchParams(location.search).get('error_description');
    if (callbackError) {
      setError(decodeURIComponent(callbackError.replace(/\+/g, ' ')));
    }
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!supabase) {
      setError(authConfigError);
      return;
    }

    if (!email || (mode !== 'reset' && password.length < 6)) {
      setError(mode === 'reset' ? 'Enter a valid email address.' : 'Use an email and a password of at least 6 characters.');
      return;
    }

    setBusy(true);
    const result =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : mode === 'reset'
          ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: getAuthRedirectUrl('/reset-password') })
          : await supabase.auth.signInWithPassword({ email, password });

    setBusy(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setMessage(mode === 'reset' ? 'Reset instructions sent.' : mode === 'signup' ? 'Check your email to confirm your account.' : 'Signed in.');
  };

  const google = async () => {
    if (googleBusy) return;
    setError('');
    setMessage('');

    if (!supabase) {
      setError(authConfigError);
      return;
    }

    setGoogleBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: googleAuthRedirectUrl } });
    setGoogleBusy(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage('Redirecting to Google�');
  };

  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="brand-row">
          <div className="brand-mark small"><Radio size={18} /></div>
          <span>ARXYN</span>
        </div>
        <div className="auth-copy">
          <p className="eyebrow">ONE SOUND. EVERYONE.</p>
          <h1>Listen together.<br /><em>Stay synchronized.</em></h1>
          <p>Rooms for moments that sound better shared.</p>
        </div>
        <div className="auth-signal" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <main className="auth-card">
        <div className="auth-mobile-brand">
          <span className="brand-mark" style={{width: 24, height: 24}}><Radio size={14} /></span>
          ARXYN
        </div>
        <p className="eyebrow">WELCOME BACK</p>
        <h2>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}</h2>

        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>

          {mode !== 'reset' && (
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </label>
          )}

          {initError && <div className="form-error"><AlertCircle size={15} />{initError}</div>}
          {error && <div className="form-error"><AlertCircle size={15} />{error}</div>}
          {message && <div className="form-success"><Check size={15} />{message}</div>}

          <button className="primary-button full" type="submit" disabled={busy}>
            {busy ? <><LoaderCircle className="spin" size={16} />{mode === 'reset' ? 'Sending' : mode === 'signup' ? 'Creating' : 'Signing in'}</> : mode === 'reset' ? 'Send reset email' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="auth-divider"><span>or continue with</span></div>

        <button className="secondary-button full" type="button" onClick={google} disabled={googleBusy}>
          {googleBusy ? <><LoaderCircle className="spin" size={16} />Connecting</> : 'Google'}
        </button>

        <div className="auth-switcher">
          {mode !== 'signin' && <button type="button" onClick={() => setMode('signin')}>Back to sign in</button>}
          {mode === 'signin' && <button type="button" onClick={() => setMode('signup')}>Create account</button>}
          {mode === 'signin' && <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>}
        </div>
      </main>
    </div>
  );
}

function Shell({
  session,
  view,
  setView,
  roomId,
  openRoom,
  modal,
  setModal,
  dark,
  setDark,
  logout,
  notify,
  toast,
  onRoomDeleted,
}: {
  session: Session;
  view: View;
  setView: (view: View) => void;
  roomId: string | null;
  openRoom: (id: string) => void;
  modal: 'create' | 'join' | null;
  setModal: (modal: 'create' | 'join' | null) => void;
  dark: boolean;
  setDark: (dark: boolean) => void;
  logout: () => Promise<void>;
  notify: (text: string) => void;
  toast: string;
  onRoomDeleted: () => void;
}) {
  const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'there';

  return (
    <div className={dark ? 'app' : 'app light'}>
      <aside className="sidebar">
        <div className="brand" aria-label="SYNCWAVE brand">
          <span className="brand-mark"><Radio size={17} /></span>
          <span>SYNCWAVE</span>
        </div>

        <nav className="nav-main" aria-label="Main navigation">
          <button className={view === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setView('home')}>
            <HomeIcon size={18} />Home
          </button>

          <div className="nav-section-title">Syncwave</div>
          <button className={view === 'rooms' || view === 'room' ? 'nav-item active' : 'nav-item'} onClick={() => setView('rooms')}>
            <Users size={18} />Listening Together
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="profile-chip">
            <div className="avatar avatar-ra">{name[0]?.toUpperCase() || 'A'}</div>
            <div>
              <strong>{name}</strong>
              <small>{session.user.email}</small>
            </div>
          </div>
          
          <button className="nav-item" onClick={() => setDark(!dark)}>
            <Menu size={18} />{dark ? 'Light theme' : 'Dark theme'}
          </button>
          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />Sign out
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" style={{width:24,height:24}}><Radio size={14} /></span> SYNCWAVE
          </div>
          <div className="top-actions">
            <button className="icon-button small" onClick={() => setDark(!dark)} aria-label="Toggle theme">✨</button>
            <button className="icon-button small" onClick={logout} title="Sign out"><LogOut size={14} /></button>
            <div className="avatar tiny avatar-ra" onClick={() => setView('profile')} style={{ cursor: 'pointer' }}>{name[0]?.toUpperCase() || 'A'}</div>
          </div>
        </header>

        {view === 'home' && <Home setModal={setModal} openRoom={openRoom} userId={session.user.id} />}
        {view === 'rooms' && <Rooms userId={session.user.id} setModal={setModal} openRoom={openRoom} />}
        {view === 'profile' && <Profile user={session.user} logout={logout} notify={notify} />}
        {view === 'settings' && <SettingsView dark={dark} setDark={setDark} logout={logout} />}
        {roomId && <Room roomId={roomId} userId={session.user.id} notify={notify} onRoomDeleted={onRoomDeleted} isHidden={view !== 'room'} onExpand={() => setView('room')} />}
        {['browse', 'search', 'library', 'playlists', 'downloads', 'connected'].includes(view) && (
          <div className="content"><div className="empty-state"><Music2 size={24} /><h3>Coming Soon</h3><p>This premium feature is under construction.</p></div></div>
        )}
      </main>

      <nav className="mobile-nav">
        <button className={`mobile-nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>
          <HomeIcon size={20} />Home
        </button>
        <button className={`mobile-nav-item ${view === 'search' ? 'active' : ''}`} onClick={() => setView('search')}>
          <Search size={20} />Search
        </button>
        <button className={`mobile-nav-item ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')}>
          <Music2 size={20} />Library
        </button>
        <button className={`mobile-nav-item ${view === 'rooms' || view === 'room' ? 'active' : ''}`} onClick={() => setView('rooms')}>
          <Radio size={20} />Sync
        </button>
      </nav>

      {modal === 'create' && <CreateRoom userId={session.user.id} close={() => setModal(null)} openRoom={openRoom} notify={notify} />}
      {modal === 'join' && <JoinRoom close={() => setModal(null)} openRoom={openRoom} notify={notify} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Home({ setModal, openRoom, userId }: { setModal: (modal: 'create' | 'join' | null) => void; openRoom: (id: string) => void; userId: string }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRooms = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('rooms')
        .select(roomSelectColumns)
        .eq('host_id', userId)
        .order('created_at', { ascending: false });

      if (!error) {
        setRooms(data ?? []);
      }
      setLoading(false);
    };

    void loadRooms();
  }, [userId]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

  // Dummy data for premium look
  const recentTracks = [
    { title: 'Starboy', artist: 'The Weeknd', art: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300&q=80' },
    { title: 'Midnight City', artist: 'M83', art: 'https://images.unsplash.com/photo-1619983081563-430f63602796?w=300&q=80' },
    { title: 'Levitating', artist: 'Dua Lipa', art: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80' },
    { title: 'Blinding Lights', artist: 'The Weeknd', art: 'https://images.unsplash.com/photo-1493225457124-a1a2a5956092?w=300&q=80' },
    { title: 'As It Was', artist: 'Harry Styles', art: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80' },
  ];

  return (
    <div className="content fade-in">
      <h1 className="greeting">{greeting}</h1>

      <div className="featured-hero">
        <div className="featured-content">
          <div>
            <p className="eyebrow">NEW RELEASE</p>
            <h3>Dawn FM</h3>
            <p>The Weeknd</p>
          </div>
          <button className="featured-play"><Play fill="currentColor" size={24} style={{marginLeft: 4}} /></button>
        </div>
      </div>

      <h2 className="section-title">Recently Played <span className="more">See All</span></h2>
      <div className="horizontal-scroll">
        {recentTracks.map((track, i) => (
          <div key={i} className="music-card">
            <div className="music-art" style={{ background: `url(${track.art}) center/cover` }}>
              <div className="music-play-overlay"><div className="play-btn"><Play fill="currentColor" size={20} style={{marginLeft: 3}} /></div></div>
            </div>
            <div className="music-card-info">
              <h4>{track.title}</h4>
              <p>{track.artist}</p>
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Listening Sessions <span className="more">View All</span></h2>
      
      <div className="quick-actions" style={{marginBottom: 24}}>
        <button className="primary-button" onClick={() => setModal('create')}>
          <Plus size={18} /> Create a Listening Session
        </button>
        <button className="secondary-button" onClick={() => setModal('join')}>
          <Search size={17} /> Join Session
        </button>
      </div>

      <div className="session-grid">
        {loading ? (
          <div className="empty-state"><LoaderCircle className="spin" size={22} /> Loading sessions</div>
        ) : rooms.length === 0 ? (
          <div className="empty-state" style={{gridColumn: '1/-1'}}>
            <Radio size={26} />
            <h4>No active sessions</h4>
            <p>Create a session to listen to music with your friends.</p>
          </div>
        ) : (
          rooms.map((room) => (
            <button key={room.id} className="session-card" onClick={() => openRoom(room.id)}>
              <div className="wave-bg" />
              <div className="session-header">
                <span className="live-pill"><i /> LIVE</span>
                <Users size={16} color="var(--text-secondary)" />
              </div>
              <div className="session-info">
                <h3>{room.name}</h3>
                <div className="session-meta">
                  <span style={{color: 'var(--accent-primary)'}}>{room.code}</span>
                  <span>•</span>
                  <span>{room.max_participants} max listeners</span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Rooms({ userId, setModal, openRoom }: { userId: string; setModal: (modal: 'create' | 'join' | null) => void; openRoom: (id: string) => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRooms = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('rooms')
        .select(roomSelectColumns)
        .eq('host_id', userId)
        .order('created_at', { ascending: false });

      if (!error) {
        setRooms(data ?? []);
      }
      setLoading(false);
    };

    void loadRooms();
  }, [userId]);

  return (
    <div className="content fade-in">
      <div className="page-title">
        <div>
          <p className="eyebrow">ARXYN LIBRARY</p>
          <h1>My Rooms</h1>
        </div>
        <button className="primary-button" onClick={() => setModal('create')}>
          <Plus size={18} />Create room
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><LoaderCircle className="spin" size={24} />Loading your rooms</div>
      ) : rooms.length === 0 ? (
        <div className="empty-state">
          <Radio size={28} />
          <h3>No rooms yet</h3>
          <p>Create your first room to begin listening with friends.</p>
          <button className="primary-button" onClick={() => setModal('create')}>Create Your First Room</button>
        </div>
      ) : (
        <div className="room-list">
          {rooms.map((room) => (
            <button key={room.id} className="room-card" onClick={() => openRoom(room.id)}>
              <div className="card-image" style={{ background: gradient }}>
                <span className="live-pill"><i />READY</span>
              </div>
              <div className="room-card-body">
                <div>
                  <h4>{room.name}</h4>
                  <p>{room.visibility} � {room.code}</p>
                </div>
                <span className="connected">{room.max_participants} max</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateRoom({ userId, close, openRoom, notify }: { userId: string; close: () => void; openRoom: (id: string) => void; notify: (text: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('10');
  const [visibility, setVisibility] = useState('public');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    if (!name.trim()) {
      setError('Give your room a name.');
      return;
    }

    if (!userId) {
      setError('You must be signed in to create a room.');
      return;
    }

    let nextCode = generateRoomCode();
    setBusy(true);

    try {
      let uniqueCode = nextCode;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data: existingRoom } = await supabase
          .from('rooms')
          .select('id')
          .eq('code', uniqueCode)
          .maybeSingle();

        if (!existingRoom) {
          break;
        }

        uniqueCode = generateRoomCode();
      }

      const { data, error: insertError } = await supabase
        .from('rooms')
        .insert({
          code: uniqueCode,
          name: name.trim(),
          description: description.trim() || null,
          max_participants: Number(maxParticipants || 10),
          visibility,
          host_id: userId,
        })
        .select('id')
        .single();

      if (insertError) {
        setError(insertError.message);
        console.error('Create room error', insertError);
        return;
      }

      close();
      notify('Room created');
      if (data?.id) openRoom(data.id);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Room creation failed.';
      setError(message);
      console.error('Create room failure', caughtError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create a Listening Session" close={close}>
      <div className="form-grid">
        <label>
          Room Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunset Sessions" autoFocus />
        </label>

        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Late-night listening, vinyl warmups, and deep cuts." rows={3} />
        </label>

        <label>
          Maximum Participants
          <input type="number" min={2} max={100} value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} />
        </label>

        <label>
          Visibility
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
      </div>

      {error && <div className="form-error"><AlertCircle size={15} />{error}</div>}

      <button className="primary-button full" onClick={create} disabled={busy}>
        {busy ? <><LoaderCircle className="spin" size={16} />Creating room...</> : 'Create Room'}
      </button>
    </Modal>
  );
}

function JoinRoom({ close, openRoom, notify }: { close: () => void; openRoom: (id: string) => void; notify: (text: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const getJoinErrorMessage = (joinError: { message?: string }) => {
    const message = joinError.message?.toUpperCase() || '';
    if (message.includes('AUTH_REQUIRED')) return 'Please log in before joining a room.';
    if (message.includes('ROOM_NOT_FOUND')) return 'Room not found. Please check the room code.';
    return 'Unable to join room. Please check the room code.';
  };

  const join = async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    const normalized = code.trim().toUpperCase();
    if (!normalized || normalized.length !== 6) {
      setError('Enter a valid 6-character room code.');
      return;
    }

    setBusy(true);
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select(roomSelectColumns)
      .eq('code', normalized)
      .maybeSingle();

    if (roomError) {
      logSupabaseError('rooms', 'SELECT room by code', roomError);
      setBusy(false);
      setError('Unable to find this room. Please check the room code.');
      return;
    }

    if (!room) {
      setBusy(false);
      setError('Room not found. Check the code and try again.');
      return;
    }

    try {
      await joinRoom(room.id);
    } catch (joinError) {
      const errorMessage = joinError instanceof Error ? joinError.message : String(joinError);
      logSupabaseError('join_room RPC', 'JOIN room by code', { message: errorMessage });
      setBusy(false);
      setError(getJoinErrorMessage({ message: errorMessage }));
      return;
    }

    setBusy(false);

    close();
    notify(`Connected to Room ${room.code}`);
    openRoom(room.id);
  };

  return (
    <Modal title="Join Session" close={close}>
      <div className="join-room-wrap">
        <div className="join-methods">
          <button className="join-tab active" type="button">Enter Room Code</button>
          <button className="join-tab" type="button">Scan QR Code</button>
        </div>

        <label>
          Room Code
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ARX7K9" autoFocus />
        </label>

        {error && <div className="form-error"><AlertCircle size={15} />{error}</div>}

        <button className="primary-button full" onClick={join} disabled={busy}>
          {busy ? <><LoaderCircle className="spin" size={16} />Joining room...</> : <>Join room <ArrowUpRight size={16} /></>}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-modal" onClick={close} aria-label="Close dialog">
          <X size={19} />
        </button>
        <p className="eyebrow">ARXYN ROOM</p>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Profile({ user, logout, notify }: { user: Session['user']; logout: () => Promise<void>; notify: (text: string) => void }) {
  const [name, setName] = useState(user.user_metadata?.full_name || '');

  const save = async () => {
    if (!supabase) {
      notify('Supabase is not configured.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    notify(error ? 'Profile update failed' : 'Profile updated');
  };

  return (
    <div className="content narrow">
      <div className="page-title">
        <div>
          <p className="eyebrow">ACCOUNT</p>
          <h1>Profile</h1>
        </div>
      </div>

      <section className="settings-panel">
        <label>
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        <label>
          Email address
          <input value={user.email || ''} disabled />
        </label>
        <button className="primary-button" onClick={save}>Save profile</button>
        <button className="danger-button" onClick={logout}><LogOut size={16} />Sign out</button>
      </section>
    </div>
  );
}

function SettingsView({ dark, setDark, logout }: { dark: boolean; setDark: (dark: boolean) => void; logout: () => Promise<void> }) {
  return (
    <div className="content narrow">
      <div className="page-title">
        <div>
          <p className="eyebrow">PREFERENCES</p>
          <h1>Settings</h1>
        </div>
      </div>

      <section className="settings-panel">
        <div className="setting-row">
          <div>
            <strong>Theme</strong>
            <small>Choose how ARXYN looks</small>
          </div>
          <select value={dark ? 'dark' : 'light'} onChange={(e) => setDark(e.target.value === 'dark')}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Audio quality</strong>
            <small>Follows source and network</small>
          </div>
          <span className="setting-value">Balanced</span>
        </div>
        <button className="danger-button" onClick={logout}><LogOut size={16} />Sign out</button>
      </section>
    </div>
  );
}

function Room({ roomId, userId, notify, onRoomDeleted, isHidden, onExpand }: { roomId: string; userId: string; notify: (text: string) => void; onRoomDeleted: () => void; isHidden?: boolean; onExpand?: () => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [songReady, setSongReady] = useState<string>('');
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('connected');
  const [volume, setVolume] = useState(0.8);
  const [profileName, setProfileName] = useState('You');
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const currentItemRef = useRef<QueueItem | null>(null);
  const isTransitioningRef = useRef(false);
  const localStateReceiveTimeRef = useRef<number>(0);
  const lastHardSeekRef = useRef<number>(0);
  const wasBufferingRef = useRef<boolean>(false);
  const scheduledPlayTimeoutRef = useRef<number | null>(null);
  const latestPlaybackStateRef = useRef<PlaybackState | null>(null);
  const lastSequenceNumberRef = useRef<number | null>(null);
  const lastProcessedSequenceRef = useRef<number | null>(null);
  const roomChannelRef = useRef<any>(null);
  const playerRef = useRef<any>(null);
  const lastSyncRef = useRef(0);

  const isHost = room?.host_id === userId;
  const currentItem = React.useMemo(() => {
    if (playback?.media_id) {
       const found = queue.find(item => item.media_id === playback.media_id);
       if (found) return found;
       return {
         id: 'temp-' + playback.media_id,
         room_id: playback.room_id,
         media_id: playback.media_id,
         title: playback.title || 'Unknown',
         artist: playback.artist || 'Unknown',
         artwork_url: playback.artwork_url || null,
         position: 0,
         duration_ms: null,
         source_type: (playback.media_id.includes('youtube.com') || playback.media_id.includes('youtu.be')) ? 'youtube' : 'upload',
         created_at: new Date().toISOString()
       } as QueueItem;
    }
    return queue[0] ?? null;
  }, [queue, playback]);
  const roomUrl = getRoomUrl(roomId);
  const connectedListeners = presenceUsers.filter((presenceUser) => presenceUser.user_id !== room?.host_id);
  const visibleMembers = connectedListeners.length
    ? connectedListeners.map((presenceUser) => ({
        user_id: presenceUser.user_id,
        role: presenceUser.is_host ? 'owner' : 'member',
        joined_at: new Date(presenceUser.joined_at).toISOString(),
        display_name: presenceUser.display_name,
      }))
    : members.filter((member) => member.user_id !== room?.host_id);

  const normalizePresenceUsers = (presenceState: Record<string, Array<Record<string, unknown>>> | undefined) => {
    const entries = Object.values(presenceState ?? {}).flatMap((value) => value ?? []);
    const deduped = new Map<string, PresenceUser>();

    entries.forEach((entry) => {
      const payload = entry as Partial<PresenceUser> & { user_id?: string; display_name?: string; joined_at?: number | string; is_host?: boolean };
      const userId = payload.user_id;
      if (!userId) return;

      deduped.set(userId, {
        user_id: userId,
        display_name: String(payload.display_name || 'Guest'),
        joined_at: Number(payload.joined_at ?? Date.now()),
        is_host: Boolean(payload.is_host),
      });
    });

    return [...deduped.values()].sort((a, b) => {
      if (a.is_host !== b.is_host) return a.is_host ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(successMessage);
    } catch (copyError) {
      console.error('Room sharing clipboard error', copyError);
      notify('Unable to copy to clipboard.');
    }
  };

  const handleShareRoom = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Join my ARXYN room', text: 'Join my music room on ARXYN', url: roomUrl });
      } else {
        await copyText(roomUrl, 'Room link copied!');
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      console.error('Room share error', shareError);
      notify('Unable to share this room.');
    }
  };

  const getCurrentAudioUrl = () => getQueueAudioUrl(currentItem);

  const clearScheduledPlay = () => {
    if (scheduledPlayTimeoutRef.current !== null) {
      window.clearTimeout(scheduledPlayTimeoutRef.current);
      scheduledPlayTimeoutRef.current = null;
    }
  };

  const sendRealtimePlaybackCommand = async (command: 'PLAY' | 'PAUSE' | 'SEEK' | 'SONG_CHANGE' | 'SYNC', authoritativeState: PlaybackState) => {
    if (!supabase || !roomId) return;
    const channel = roomChannelRef.current;
    if (!channel) {
      console.warn('No room channel available for playback command');
      return;
    }

    const payload = {
      command,
      roomId,
      playbackState: authoritativeState,
      commandId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };

    if (command === 'PLAY') {
      console.log('HOST PLAY SENT', payload);
    } else if (command === 'PAUSE') {
      console.log('HOST PAUSE MESSAGE SENT', payload);
    }

    await channel.send({
      type: 'broadcast',
      event: 'playback-command',
      payload,
    });
  };

  const applyAuthoritativePlaybackState = (state: PlaybackState) => {
    latestPlaybackStateRef.current = state;
    
    // We only control playback for members, not the host.
    if (isHost) return;

    if (state.is_playing === false) {
      console.log(`[SYNC] MEMBER PAUSED sequence=${state.sequence_number}`);
      clearScheduledPlay();
      setIsAudioPlaying(false);
      
      const player = playerRef.current;
      if (player) {
        const position = Number(state.position_ms ?? 0) / 1000;
        safeSeek(player, position);
        setCurrentTime(position);
      }
      return;
    }

    // PLAYING BRANCH
    console.log(`[SYNC] MEMBER RECEIVED PLAY sequence=${state.sequence_number}`);
    
    setIsAudioPlaying(true);
    console.log('[SYNC] AUDIO PLAYING');
    setAutoplayBlocked(false);
    wasBufferingRef.current = false;

    const player = playerRef.current;
    if (player) {
      const expectedPosition = getExpectedPlaybackPosition(latestPlaybackStateRef.current ?? state, localStateReceiveTimeRef.current || undefined);
      if (Number.isFinite(expectedPosition)) {
        const currentPos = safeGetCurrentTime(player) || 0;
        console.log(`[SYNC] EXPECTED POSITION: ${expectedPosition.toFixed(3)}s, ACTUAL POSITION: ${currentPos.toFixed(3)}s`);
        const drift = Math.abs(expectedPosition - currentPos);
        if (drift > 0.5) {
          console.log(`[SYNC] HARD SEEK position=${expectedPosition.toFixed(3)}`);
          safeSeek(player, expectedPosition);
          setCurrentTime(expectedPosition);
          lastHardSeekRef.current = Date.now();
        }
      }
    }
  };

  useEffect(() => {
    latestPlaybackStateRef.current = playback;
  }, [playback]);

  const loadRoomMembers = async (client: NonNullable<typeof supabase>) => {
    try {
      const { data: memberRows, error: memberError } = await client.from('room_members').select('*').eq('room_id', roomId);
      if (memberError) {
        logSupabaseError('room_members', 'SELECT room members', memberError);
        setMembers([]);
        return;
      }

      const userIds = [...new Set((memberRows ?? []).map((member) => member.user_id))];
      const { data: profileRows, error: profileError } = userIds.length
        ? await client.from('profiles').select('id, name, email').in('id', userIds)
        : { data: [], error: null };

      if (profileError) {
        logSupabaseError('profiles', 'SELECT room profiles', profileError);
      }

      const profileMap = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
      setMembers((memberRows ?? []).map((member) => ({
        user_id: member.user_id,
        role: member.role,
        joined_at: member.joined_at,
        display_name: profileMap.get(member.user_id)?.name || profileMap.get(member.user_id)?.email || 'User',
      })));
    } catch (memberLoadError) {
      console.error('Optional room member loading failed:', memberLoadError);
      setMembers([]);
    }
  };

  // Drift correction interval
  useEffect(() => {
    if (isHost) return;
    
    const syncInterval = window.setInterval(() => {
      const state = latestPlaybackStateRef.current;
      
      // If host is paused, ensure we are paused
      if (!state || state.is_playing === false) {
        setIsAudioPlaying(prev => {
          if (prev) return false;
          return prev;
        });
        return;
      }
      
      const player = playerRef.current;
      if (!player) return;

      // Force play if we should be playing but fell out of sync (e.g. after a buffer drop)
      if (!autoplayBlocked) {
        setIsAudioPlaying(prev => {
          if (!prev) return true;
          return prev;
        });
      }
      
      const expectedPosition = getExpectedPlaybackPosition(state, localStateReceiveTimeRef.current || undefined);
      if (Number.isFinite(expectedPosition)) {
         const currentPos = safeGetCurrentTime(player) || 0;
         const drift = expectedPosition - currentPos;
         const absDrift = Math.abs(drift);
         
         if (absDrift >= 1.5) {
           const now = Date.now();
           if (now - lastHardSeekRef.current > 4000) {
             console.log(`[SYNC] HARD CORRECTION drift=${drift.toFixed(3)}s`);
             safeSeek(player, expectedPosition);
             setCurrentTime(expectedPosition);
             lastHardSeekRef.current = now;
           } else {
             console.log(`[SYNC] HARD SEEK BLOCKED BY COOLDOWN drift=${drift.toFixed(3)}s`);
           }
         }
      }
    }, 200);
    
    return () => window.clearInterval(syncInterval);
  }, [isHost]);

  useEffect(() => {
    const loadRoom = async () => {
      if (!supabase) return;
      const client = supabase;

      const { data: roomData, error: roomError } = await client
        .from('rooms')
        .select(roomSelectColumns)
        .eq('id', roomId)
        .maybeSingle();

      if (roomError || !roomData) {
        if (!roomData) {
          setError('Room no longer exists.');
        } else {
          logSupabaseError('rooms', 'SELECT room', roomError ?? { message: 'Unknown room query error.' });
          setError('Unable to load this room. Please try again.');
        }
        return;
      }

      setRoom(roomData as Room);

      try {
        await joinRoom(roomId);
      } catch (joinError) {
        const errorMessage = joinError instanceof Error ? joinError.message : String(joinError);
        logSupabaseError('join_room RPC', 'JOIN room', { message: errorMessage });
        setError('Unable to join this room. Please try again.');
        return;
      }

      const { data: queueData, error: queueError } = await client
        .from('queue_items')
        .select('id, room_id, media_id, title, artist, artwork_url, position, duration_ms, source_type, created_at, requested_by')
        .eq('room_id', roomId)
        .order('position', { ascending: true });

      if (queueError) {
        logSupabaseError('queue_items', 'SELECT room queue', queueError);
        setError(`Unable to load queue: ${queueError.message}`);
        return;
      }

      setQueue((queueData ?? []) as QueueItem[]);

      const { data: playbackData, error: playbackError } = await client
        .from('playback_state')
        .select('*')
        .eq('room_id', roomId)
        .maybeSingle();

      if (playbackError) {
        logSupabaseError('playback_state', 'SELECT room playback', playbackError);
        setError(`Unable to load playback: ${playbackError.message}`);
        return;
      }

      if (playbackData) {
        setPlayback(playbackData as PlaybackState);
        if (roomData.host_id !== userId) {
           applyAuthoritativePlaybackState(playbackData as PlaybackState);
        }
      } else {
        setPlayback({
          room_id: roomId,
          media_id: null,
          title: null,
          artist: null,
          artwork_url: null,
          is_playing: false,
          position_ms: 0,
          server_timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sequence_number: 0,
        });
      }

      void loadRoomMembers(client);
      setIsInitialLoadDone(true);
    };

    void loadRoom();
  }, [roomId, userId]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!error && data.user) {
        const nextName = data.user.user_metadata?.full_name || data.user.email || 'You';
        setProfileName(nextName);
      }
    });
  }, [userId]);


  useEffect(() => {
    if (!supabase || !roomId || !isInitialLoadDone) return;
    const client = supabase;

    const channel = client.channel(`room:${roomId}`);
    roomChannelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        setPresenceUsers(normalizePresenceUsers(channel.presenceState() as Record<string, Array<Record<string, unknown>>>));
      })
      .on('presence', { event: 'join' }, () => {
        setPresenceUsers(normalizePresenceUsers(channel.presenceState() as Record<string, Array<Record<string, unknown>>>));
      })
      .on('presence', { event: 'leave' }, () => {
        setPresenceUsers(normalizePresenceUsers(channel.presenceState() as Record<string, Array<Record<string, unknown>>>));
      })
      .on('broadcast', { event: 'playback-command' }, (payload) => {
        const data = payload.payload as { command?: string; roomId?: string; playbackState?: PlaybackState } | undefined;
        if (!data || data.roomId !== roomId || !data.playbackState) return;

        const command = data.command;
        const nextState = data.playbackState;
        
        if (command === 'SYNC') {
          // Telemetry - update reference silently for drift correction interval
          latestPlaybackStateRef.current = nextState;
          localStateReceiveTimeRef.current = Date.now();
          if (!isHost) setPlayback(nextState);
          return;
        }

        const nextSequence = Number(nextState.sequence_number ?? -1);
        const previousSequence = lastProcessedSequenceRef.current ?? -1;

        if (nextSequence <= previousSequence && previousSequence !== -1) {
          console.log(`[SYNC] IGNORED STALE sequence=${nextSequence}`, { previousSequence, nextState });
          return;
        }

        lastProcessedSequenceRef.current = nextSequence;
        latestPlaybackStateRef.current = nextState;
        localStateReceiveTimeRef.current = Date.now();
        console.log(`[SYNC] MEMBER RECEIVED COMMAND sequence=${nextSequence} playing=${nextState.is_playing}`);
        applyAuthoritativePlaybackState(nextState);
        if (!isHost) setPlayback(nextState);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          notify('Room has been deleted.');
          onRoomDeleted();
          return;
        }
        setRoom((payload.new as Room) ?? null);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_items', filter: `room_id=eq.${roomId}` }, async () => {
        const { data } = await client.from('queue_items').select('id, room_id, media_id, title, artist, artwork_url, position, duration_ms, source_type, created_at, requested_by').eq('room_id', roomId).order('position', { ascending: true });
        setQueue((data ?? []) as QueueItem[]);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'playback_state', filter: `room_id=eq.${roomId}` }, (payload) => {
        if (!payload.new) return;
        const nextState = payload.new as PlaybackState;
        const nextSequence = Number(nextState.sequence_number ?? -1);
        const previousSequence = lastProcessedSequenceRef.current ?? -1;

        if (nextSequence < previousSequence) {
          console.log(`[SYNC] IGNORED STALE sequence=${nextSequence}`, { previousSequence, nextState });
          return;
        }

        if (nextSequence === previousSequence && previousSequence !== -1) {
          // Pure telemetry
          latestPlaybackStateRef.current = nextState;
          localStateReceiveTimeRef.current = Date.now();
          if (!isHost) setPlayback(nextState);
          return;
        }

        lastProcessedSequenceRef.current = nextSequence;
        latestPlaybackStateRef.current = nextState;
        localStateReceiveTimeRef.current = Date.now();
        console.log(`[SYNC] MEMBER RECEIVED state sequence=${nextSequence} playing=${nextState.is_playing}`);
        applyAuthoritativePlaybackState(nextState);
        if (!isHost) setPlayback(nextState);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'playback_state', filter: `room_id=eq.${roomId}` }, (payload) => {
        if (!payload.new) return;
        const nextState = payload.new as PlaybackState;
        const nextSequence = Number(nextState.sequence_number ?? -1);
        const previousSequence = lastProcessedSequenceRef.current ?? -1;

        if (nextSequence < previousSequence) {
          console.log(`[SYNC] IGNORED STALE sequence=${nextSequence}`, { previousSequence, nextState });
          return;
        }

        if (nextSequence === previousSequence && previousSequence !== -1) {
          // Pure telemetry update without a sequence bump
          latestPlaybackStateRef.current = nextState;
          localStateReceiveTimeRef.current = Date.now();
          if (!isHost) setPlayback(nextState);
          return;
        }

        lastProcessedSequenceRef.current = nextSequence;
        latestPlaybackStateRef.current = nextState;
        localStateReceiveTimeRef.current = Date.now();
        console.log(`[SYNC] MEMBER RECEIVED state sequence=${nextSequence} playing=${nextState.is_playing}`);
        applyAuthoritativePlaybackState(nextState);
        if (!isHost) setPlayback(nextState);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, () => {
        void loadRoomMembers(client);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          
          // Fetch latest playback state in case we missed events while disconnected
          const { data: latestPlayback } = await client
            .from('playback_state')
            .select('*')
            .eq('room_id', roomId)
            .maybeSingle();
            
          if (latestPlayback) {
            const nextState = latestPlayback as PlaybackState;
            const nextSequence = Number(nextState.sequence_number ?? -1);
            const previousSequence = lastProcessedSequenceRef.current ?? -1;
            
            if (nextSequence > previousSequence) {
              lastProcessedSequenceRef.current = nextSequence;
              latestPlaybackStateRef.current = nextState;
              applyAuthoritativePlaybackState(nextState);
              setPlayback(nextState);
            }
          }

          await channel.track({
            user_id: userId,
            display_name: 'User',
            joined_at: Date.now(),
            is_host: false, // We'll update presence later if needed
          });
          setPresenceUsers(normalizePresenceUsers(channel.presenceState() as Record<string, Array<Record<string, unknown>>>));
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus('disconnected');
        }

        if (status === 'CLOSED') {
          setConnectionStatus('reconnecting');
        }
      });

    return () => {
      setPresenceUsers([]);
      void client.removeChannel(channel);
    };
  }, [roomId, userId, isInitialLoadDone]); // REMOVED profileName and room?.host_id to prevent channel tearing

  useEffect(() => {
    if (!roomChannelRef.current || connectionStatus !== 'connected') return;
    void roomChannelRef.current.track({
      user_id: userId,
      display_name: profileName,
      joined_at: Date.now(),
      is_host: room?.host_id === userId,
    });
  }, [profileName, room?.host_id, connectionStatus, userId]);

  const handleAddSearchResult = async (track: { title: string; artist: string; media_id: string; artwork_url: string | null; duration_ms: number; source_type: string }) => {
    if (!supabase || !isHost) return;
    
    setSongReady(`Adding ${track.title}...`);
    const nextPosition = queue.length + 1;
    
    const { data: insertedItem, error: insertError } = await supabase.from('queue_items').insert({
      room_id: roomId,
      media_id: track.media_id,
      title: track.title,
      artist: track.artist,
      artwork_url: track.artwork_url,
      position: nextPosition,
      requested_by: userId,
      source_type: track.source_type,
      duration_ms: track.duration_ms,
      status: 'queued',
    }).select('id, room_id, media_id, title, artist, artwork_url, position, duration_ms, source_type, created_at, requested_by').single();

    if (insertError) {
      logSupabaseError('queue_items', 'INSERT search result', insertError);
      notify(insertError.message);
      setSongReady(insertError.message);
    } else if (insertedItem) {
      setQueue((existingQueue) => [...existingQueue, insertedItem as QueueItem].sort((left, right) => left.position - right.position));
      setSongReady(`${track.title} added`);
      notify(`Added ${track.title} to queue`);
    }
  };

  const handleAddSong = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length || !supabase) return;

    setUploading(true);
    setSongReady('Uploading Song...');
    let nextPosition = queue.length + 1;

    try {
      for (const file of files) {
        if (!isAudioFile(file)) {
          const message = `${file.name} is not a supported audio file.`;
          notify(message);
          setSongReady(message);
          continue;
        }

        const safeFileName = getSafeAudioFileName(file.name);
        const uploadPath = `${roomId}/${crypto.randomUUID()}-${safeFileName}`;
        const uploadLog = {
          bucket: audioBucket,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          roomId,
          uploadPath,
        };
        console.log('AUDIO UPLOAD DEBUG', uploadLog);
        console.log('Uploading audio to bucket:', audioBucket);
        const { data: uploadedFile, error: uploadError } = await supabase.storage.from(audioBucket).upload(uploadPath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) {
          const errorDetails = uploadError as unknown as Record<string, unknown>;
          console.error('AUDIO STORAGE UPLOAD ERROR', {
            bucket: audioBucket,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            roomId,
            uploadPath,
            name: errorDetails.name,
            message: errorDetails.message,
            status: errorDetails.status,
            statusCode: errorDetails.statusCode,
            error: errorDetails.error,
            cause: errorDetails.cause,
            raw: uploadError,
            json: JSON.stringify(errorDetails),
          });
          logSupabaseError(`storage.objects (${audioBucket})`, 'INSERT/upload', uploadError);
          const message = uploadError.message.toLowerCase().includes('bucket not found')
            ? "Audio storage is not configured. Please create the 'room-audio' storage bucket in Supabase and make it public."
            : uploadError.message;
          notify(message);
          setSongReady(message);
          continue;
        }

        const uploadedPath = uploadedFile?.path || uploadPath;
        const audioUrl = getPublicStorageUrl(uploadedPath, audioBucket);
        console.log('AUDIO UPLOAD RESPONSE', uploadedFile);
        console.log('Uploaded audio path:', uploadedPath);
        console.log('AUDIO URL', audioUrl);
        console.log('Playable audio URL:', audioUrl);

        const item: QueueItem = {
          id: crypto.randomUUID(),
          room_id: roomId,
          media_id: uploadedPath,
          title: file.name.replace(/\.[^/.]+$/, ''),
          artist: 'Shared upload',
          artwork_url: null,
          position: nextPosition,
          duration_ms: 0,
          source_type: 'shared_upload',
          created_at: new Date().toISOString(),
          requested_by: userId,
        };

        const { data: insertedItem, error: insertError } = await supabase.from('queue_items').insert({
          room_id: roomId,
          media_id: uploadedPath,
          title: item.title,
          artist: item.artist,
          artwork_url: item.artwork_url,
          position: nextPosition,
          requested_by: userId,
          source_type: 'shared_upload',
          duration_ms: item.duration_ms,
          status: 'queued',
        }).select('id, room_id, media_id, title, artist, artwork_url, position, duration_ms, source_type, created_at, requested_by').single();

        if (insertError) {
          logSupabaseError('queue_items', 'INSERT', insertError);
          const { error: cleanupError } = await supabase.storage.from(audioBucket).remove([uploadedPath]);
          if (cleanupError) {
            logSupabaseError(`storage.objects (${audioBucket})`, 'DELETE orphaned upload', cleanupError);
          }
          notify(insertError.message);
          setSongReady(insertError.message);
        } else {
          if (insertedItem) {
            setQueue((existingQueue) => [...existingQueue, insertedItem as QueueItem].sort((left, right) => left.position - right.position));
          }
          nextPosition += 1;
          setSongReady(`${file.name} ready`);
        }
      }
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const reorderQueue = async (items: QueueItem[]) => {
    if (!supabase) return false;
    for (const [index, item] of items.entries()) {
      const { error: updateError } = await supabase
        .from('queue_items')
        .update({ position: index + 1 })
        .eq('id', item.id)
        .eq('room_id', roomId);
      if (updateError) {
        logSupabaseError('queue_items', 'UPDATE position', updateError);
        notify(`Unable to reorder queue: ${updateError.message}`);
        return false;
      }
    }
    return true;
  };

  const handleRemoveSong = async (item: QueueItem) => {
    if (!supabase || !isHost) return;
    if (!window.confirm(`Remove "${item.title}" from this queue?`)) return;

    const remainingItems = queue.filter((queueItem) => queueItem.id !== item.id);
    const { error: deleteError } = await supabase
      .from('queue_items')
      .delete()
      .eq('id', item.id)
      .eq('room_id', roomId);
    if (deleteError) {
      logSupabaseError('queue_items', 'DELETE', deleteError);
      notify(`Unable to remove song: ${deleteError.message}`);
      return;
    }

    console.log('QUEUE DELETE', { roomId, queueItemId: item.id, mediaId: item.media_id });
    const { error: storageError } = await supabase.storage.from(audioBucket).remove([item.media_id]);
    if (storageError) {
      console.warn('Queue audio removal from room-audio failed; retrying with legacy bucket.', storageError);
      const fallbackResult = await supabase.storage.from(legacyAudioBucket).remove([item.media_id]);
      if (fallbackResult.error) {
        logSupabaseError(`storage.objects (${audioBucket})`, 'DELETE queue audio', storageError);
        logSupabaseError(`storage.objects (${legacyAudioBucket})`, 'DELETE queue audio fallback', fallbackResult.error);
      }
    }

    if (!await reorderQueue(remainingItems)) return;
    setQueue(remainingItems.map((queueItem, index) => ({ ...queueItem, position: index + 1 })));

    if (playback?.media_id === item.media_id) {
      const nextItem = remainingItems.find((queueItem) => queueItem.position > item.position) ?? remainingItems[0];
      if (nextItem) {
        await updatePlayback({
          media_id: nextItem.media_id,
          title: nextItem.title,
          artist: nextItem.artist,
          artwork_url: nextItem.artwork_url,
          is_playing: false,
          position_ms: 0,
          server_timestamp: new Date().toISOString(),
        }, 'SONG_CHANGE');
      } else {
        if (isHost) {
          setIsAudioPlaying(false);
          await updatePlayback({ media_id: null, title: null, artist: null, artwork_url: null, is_playing: false, position_ms: 0, server_timestamp: new Date().toISOString() }, 'PAUSE');
        }
      }
    }
  };

  const handleDeleteRoom = async () => {
    if (!supabase || !isHost) return;
    if (!window.confirm('Delete this room? This will remove the room and its queue.')) return;

    const { error: playbackError } = await supabase.from('playback_state').delete().eq('room_id', roomId);
    if (playbackError) {
      logSupabaseError('playback_state', 'DELETE room playback', playbackError);
      notify(`Unable to delete room: ${playbackError.message}`);
      return;
    }
    const { error: queueError } = await supabase.from('queue_items').delete().eq('room_id', roomId);
    if (queueError) {
      logSupabaseError('queue_items', 'DELETE room queue', queueError);
      notify(`Unable to delete room: ${queueError.message}`);
      return;
    }
    const { data: audioObjects, error: listError } = await supabase.storage.from(audioBucket).list(roomId);
    if (listError) {
      console.warn('Unable to list room-audio files; checking legacy bucket.', listError);
      const fallbackResult = await supabase.storage.from(legacyAudioBucket).list(roomId);
      if (fallbackResult.error) {
        logSupabaseError(`storage.objects (${audioBucket})`, 'LIST room audio', listError);
        logSupabaseError(`storage.objects (${legacyAudioBucket})`, 'LIST room audio fallback', fallbackResult.error);
      } else if (fallbackResult.data?.length) {
        const { error: storageError } = await supabase.storage.from(legacyAudioBucket).remove(fallbackResult.data.map((object) => `${roomId}/${object.name}`));
        if (storageError) {
          logSupabaseError(`storage.objects (${legacyAudioBucket})`, 'DELETE room audio', storageError);
        }
      }
    } else if (audioObjects?.length) {
      const { error: storageError } = await supabase.storage.from(audioBucket).remove(audioObjects.map((object) => `${roomId}/${object.name}`));
      if (storageError) {
        logSupabaseError(`storage.objects (${audioBucket})`, 'DELETE room audio', storageError);
      }
    }
    const { error: roomError } = await supabase.from('rooms').delete().eq('id', roomId).eq('host_id', userId);
    if (roomError) {
      logSupabaseError('rooms', 'DELETE', roomError);
      notify(`Unable to delete room: ${roomError.message}`);
      return;
    }

    console.log('ROOM DELETE', { roomId });
    notify('Room deleted');
    onRoomDeleted();
  };

  const updatePlayback = async (nextState: Partial<PlaybackState>, command: 'PLAY' | 'PAUSE' | 'SEEK' | 'SONG_CHANGE' | 'SYNC' = 'SYNC') => {
    if (!supabase || !roomId || !isHost) return;
    const now = new Date().toISOString();
    const current = latestPlaybackStateRef.current ?? playback ?? {
      room_id: roomId,
      media_id: currentItem?.media_id ?? null,
      title: currentItem?.title ?? null,
      artist: currentItem?.artist ?? null,
      artwork_url: currentItem?.artwork_url ?? null,
      is_playing: false,
      position_ms: 0,
      server_timestamp: now,
      updated_at: now,
      sequence_number: 0,
    };

    const shouldIncrementSequence = command !== 'SYNC';
    const nextSequence = shouldIncrementSequence 
      ? (nextState.sequence_number ?? current.sequence_number ?? 0) + 1 
      : (current.sequence_number ?? 0);

    const payload = {
      room_id: roomId,
      media_id: nextState.media_id ?? current.media_id,
      title: nextState.title ?? current.title,
      artist: nextState.artist ?? current.artist,
      artwork_url: nextState.artwork_url ?? current.artwork_url,
      is_playing: nextState.is_playing ?? current.is_playing,
      position_ms: nextState.position_ms ?? current.position_ms,
      server_timestamp: nextState.server_timestamp ?? now,
      updated_at: now,
      sequence_number: nextSequence,
    };

    if (command === 'PLAY') {
      console.log(`[SYNC] HOST PLAY sequence=${nextSequence}`);
    } else if (command === 'PAUSE') {
      console.log(`[SYNC] HOST PAUSE sequence=${nextSequence}`);
    } else if (command === 'SYNC') {
      // console.log(`[SYNC] HOST TELEMETRY sequence=${nextSequence}`);
    }

    // 1. Broadcast immediately for instant realtime sync across members
    void sendRealtimePlaybackCommand(command, payload as PlaybackState);

    // 2. Update local state immediately
    latestPlaybackStateRef.current = payload as PlaybackState;
    lastSequenceNumberRef.current = nextSequence;
    lastProcessedSequenceRef.current = nextSequence;
    setPlayback(payload as PlaybackState);

    // 3. Persist to DB in the background
    const { error } = await supabase.from('playback_state').upsert(payload, { onConflict: 'room_id' });
    if (error) {
      console.error('Playback sync error (DB)', error);
    }
  };

  const handleHostPause = async () => {
    if (!supabase || !playerRef.current || !roomId || !isHost) return;

    const positionMs = Math.round((safeGetCurrentTime(playerRef.current) || 0) * 1000);
    const serverTimestamp = new Date().toISOString();
    
    console.log('HOST PAUSE BUTTON CLICKED');
    clearScheduledPlay();

    setIsAudioPlaying(false);
    safeSeek(playerRef.current, positionMs / 1000);
    setCurrentTime(positionMs / 1000);

    await updatePlayback({
      is_playing: false,
      position_ms: positionMs,
      server_timestamp: serverTimestamp,
    }, 'PAUSE');
  };

  const handlePlayPause = async () => {
    if (!playerRef.current || !currentItem || !isHost) return;

    clearScheduledPlay();
    const shouldPlay = !isAudioPlaying;

    if (shouldPlay) {
      const audioUrl = getCurrentAudioUrl();
      if (!audioUrl) {
        const message = 'Unable to play this media: no playable URL is available.';
        console.error('PLAY ERROR', message);
        notify(message);
        return;
      }

      setIsAudioPlaying(true);
      setAutoplayBlocked(false);
      
      const currentPos = safeGetCurrentTime(playerRef.current);
      const nextPosition = (typeof currentPos === 'number' && Number.isFinite(currentPos)) ? currentPos : Number(playback?.position_ms || 0) / 1000;

      const hostTimestamp = new Date().toISOString();
      const sequenceNumber = (latestPlaybackStateRef.current?.sequence_number ?? playback?.sequence_number ?? 0) + 1;
      await updatePlayback({
        media_id: currentItem.media_id,
        title: currentItem.title,
        artist: currentItem.artist,
        artwork_url: currentItem.artwork_url,
        is_playing: true,
        position_ms: Math.round(nextPosition * 1000),
        server_timestamp: hostTimestamp,
        sequence_number: sequenceNumber,
      }, 'PLAY');
    } else {
      await handleHostPause();
    }
  };



  const handleSelectTrack = async (item: QueueItem) => {
    if (!isHost) return;
    const hostTimestamp = new Date().toISOString();
    await updatePlayback({
      media_id: item.media_id,
      title: item.title,
      artist: item.artist,
      artwork_url: item.artwork_url,
      is_playing: playback?.is_playing ?? false,
      position_ms: 0,
      server_timestamp: hostTimestamp,
      sequence_number: (playback?.sequence_number ?? 0) + 1,
    }, 'SONG_CHANGE');
  };

  const handleAdjacentTrack = async (direction: -1 | 1) => {
    if (!isHost || queue.length < 2 || !currentItem) return;
    const currentIndex = queue.findIndex((item) => item.id === currentItem.id);
    const nextItem = queue[currentIndex + direction];
    if (!nextItem) return;

    const source = getQueueAudioUrl(nextItem);
    if (!source || source.startsWith('blob:') || source.startsWith('file:')) return;

    const shouldKeepPlaying = playback?.is_playing ?? false;
    setCurrentTime(0);
    setAudioDuration(0);
    setIsAudioPlaying(shouldKeepPlaying);
    setAutoplayBlocked(false);

    await updatePlayback({
      media_id: nextItem.media_id,
      title: nextItem.title,
      artist: nextItem.artist,
      artwork_url: nextItem.artwork_url,
      is_playing: shouldKeepPlaying,
      position_ms: 0,
      server_timestamp: new Date().toISOString(),
    }, 'SONG_CHANGE');
  };

  const handleSeek = async (value: number) => {
    if (!playerRef.current || !isHost) return;
    const seekTime = value;
    safeSeek(playerRef.current, seekTime);
    setCurrentTime(seekTime);
    await updatePlayback({
      media_id: currentItem?.media_id ?? null,
      title: currentItem?.title ?? null,
      artist: currentItem?.artist ?? null,
      artwork_url: currentItem?.artwork_url ?? null,
      is_playing: isAudioPlaying,
      position_ms: Math.round(seekTime * 1000),
      server_timestamp: new Date().toISOString(),
    }, 'SEEK');
  };

  const handleProgress = async (state: { playedSeconds: number, loadedSeconds: number }) => {
    setCurrentTime(state.playedSeconds);
    if (!isHost) return;
    const positionInfo = Math.round(state.playedSeconds * 1000);
    if (Date.now() - lastSyncRef.current > 1500) {
      lastSyncRef.current = Date.now();
      await updatePlayback({
        media_id: currentItem?.media_id ?? null,
        title: currentItem?.title ?? null,
        artist: currentItem?.artist ?? null,
        artwork_url: currentItem?.artwork_url ?? null,
        is_playing: isAudioPlaying,
        position_ms: positionInfo,
        server_timestamp: new Date().toISOString(),
      });
    }
  };


  const handleFullscreen = () => {
    const elem = playerWrapperRef.current as any;
    if (!elem) return;
    const doc = document as any;

    if (!doc.fullscreenElement && !doc.webkitFullscreenElement && !doc.mozFullScreenElement && !doc.msFullscreenElement) {
      if (elem.requestFullscreen) {
        void elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        void elem.webkitRequestFullscreen();
      } else if (elem.webkitEnterFullscreen) {
        void elem.webkitEnterFullscreen(); // For iOS video
      } else if (elem.mozRequestFullScreen) {
        void elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        void elem.msRequestFullscreen();
      }
    } else {
      if (doc.exitFullscreen) {
        void doc.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        void doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        void doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        void doc.msExitFullscreen();
      }
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as any;
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('mozfullscreenchange', onFullscreenChange);
    document.addEventListener('MSFullscreenChange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      document.removeEventListener('mozfullscreenchange', onFullscreenChange);
      document.removeEventListener('MSFullscreenChange', onFullscreenChange);
    };
  }, []);

  if (error) {
    return <div className="content"><div className="empty-state"><Radio size={26} /><h3>Room unavailable</h3><p>{error}</p></div></div>;
  }

  if (!room) {
    return <div className="content"><div className="empty-state"><LoaderCircle className="spin" size={24} />Loading room</div></div>;
  }

  const durationMs = audioDuration || (currentItem?.duration_ms ?? 0);
  const progress = (currentTime / Math.max(durationMs / 1000, 1)) * 100;
  const listeningNow = connectedListeners.length;
  
  const currentUserMember = members.find(m => m.user_id === userId);

  return (
    <>
      <div className="room-content fade-in" style={{ display: isHidden ? 'none' : 'block' }}>
      <div className="room-header">
        <div>
          <div className="breadcrumb"><span>SYNCWAVE /</span> <span>{getDisplayRoomName(room)}</span></div>
          <h1>{room.name}</h1>
          <div className="room-meta">
            <span className={`room-state ${connectionStatus === 'connected' ? 'online' : connectionStatus === 'reconnecting' ? 'reconnecting' : 'offline'}`}><i />{connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}</span>
            <span><Users size={14} /> {listeningNow} connected</span>
            {!isHost && <span className="code-box">Room Active</span>}
            {isHost && <span className="code-box">{room.code}</span>}
          </div>
        </div>

        {isHost && (
          <div className="header-actions">
            <button className="secondary-button" onClick={() => void copyText(room.code, 'Room code copied!')}> <Copy size={15} />Copy Code</button>
            <button className="secondary-button" onClick={() => void handleShareRoom()}>
              <Share2 size={15} />Share Room
            </button>
            <button className="secondary-button" onClick={() => setShowQr(true)}>Show QR</button>
            <button className="danger-button" onClick={() => void handleDeleteRoom()}>Delete Room</button>
          </div>
        )}
      </div>

      <div className="room-layout">
        <section className="player-panel">
          {currentItem?.source_type === 'youtube' ? (
            <div 
              ref={playerWrapperRef} 
              className="player-container"
            >
              {React.createElement(ReactPlayer as any, {
                ref: playerRef,
                url: getCurrentAudioUrl(),
                playing: isAudioPlaying,
                volume: volume,
                width: "100%",
                height: "100%",
                style: { position: 'absolute', top: 0, left: 0 },
                config: { youtube: { playerVars: { playsinline: 1, controls: 0, disablekb: 1, modestbranding: 1 } } },
                onProgress: handleProgress,
                onDuration: (dur: number) => setAudioDuration(dur * 1000),
                onPlay: () => {
                  setAutoplayBlocked(false);
                  if (isHost) {
                    setIsAudioPlaying(true);
                  } else {
                    const state = latestPlaybackStateRef.current;
                    if (state?.is_playing) {
                      setIsAudioPlaying(true);
                    } else {
                      setIsAudioPlaying(false);
                    }
                  }
                },
                onPause: () => {
                  if (isHost) {
                    setIsAudioPlaying(false);
                  } else {
                    setIsAudioPlaying(false);
                  }
                },
                onBuffer: () => { if(!isHost) wasBufferingRef.current = true; },
                onBufferEnd: () => {
                  if (!isHost) {
                    wasBufferingRef.current = false;
                  }
                },
                onError: (e: any) => {
                  console.error('PLAYER ERROR', e);
                  setAutoplayBlocked(true);
                },
                onEnded: () => {
                  setIsAudioPlaying(false);
                  void handleAdjacentTrack(1);
                }
              })}
              {/* FULLSCREEN BUTTON */}
              <button onClick={handleFullscreen} className="fullscreen-button" style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', zIndex: 10 }}>
                {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          ) : (
            <div ref={playerWrapperRef} className="player-art-wrap" style={{ position: 'relative' }}>
              <div className="player-art" style={{ background: currentItem?.artwork_url ? `url(${currentItem.artwork_url}) center/cover no-repeat` : gradient }}></div>
              <div className="art-overlay">
                <span className="live-pill"><i /> LIVE</span>
                <span>{room.visibility}</span>
              </div>
              {React.createElement(ReactPlayer as any, {
                ref: playerRef,
                url: getCurrentAudioUrl(),
                playing: isAudioPlaying,
                volume: volume,
                width: "100%",
                height: "100%",
                style: { position: 'absolute', top: 0, left: 0, opacity: 0, pointerEvents: 'none' },
                onProgress: handleProgress,
                onDuration: (dur: number) => setAudioDuration(dur * 1000),
                onPlay: () => {
                  setAutoplayBlocked(false);
                  if (isHost) {
                    setIsAudioPlaying(true);
                  } else {
                    const state = latestPlaybackStateRef.current;
                    if (state?.is_playing) {
                      setIsAudioPlaying(true);
                    } else {
                      setIsAudioPlaying(false);
                    }
                  }
                },
                onPause: () => {
                  if (isHost) {
                    setIsAudioPlaying(false);
                  } else {
                    setIsAudioPlaying(false);
                  }
                },
                onBuffer: () => { if(!isHost) wasBufferingRef.current = true; },
                onBufferEnd: () => {
                  if (!isHost) {
                    wasBufferingRef.current = false;
                  }
                },
                onError: (e: any) => {
                  console.error('PLAYER ERROR', e);
                  setAutoplayBlocked(true);
                },
                onEnded: () => {
                  setIsAudioPlaying(false);
                  void handleAdjacentTrack(1);
                }
              })}
              {/* FULLSCREEN BUTTON */}
              <button onClick={handleFullscreen} className="fullscreen-button" style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', zIndex: 10 }}>
                {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          )}

          <div className="track-info-large">
            <div>
              <h2>{currentItem?.title || 'No song selected'}</h2>
              <p>{currentItem?.artist || 'Awaiting host'}</p>
            </div>
            <button className="like-button" aria-label="Like song">♡</button>
          </div>

          <div className="status-row">
            <span className={`status-pill ${playback?.is_playing ? 'playing' : ''}`}>{playback?.is_playing ? '🟢 Playing' : '⏸ Paused'}</span>
            <span className="status-pill">{isHost ? 'Host control' : 'Synchronized with Host'}</span>
          </div>

          {/* UNIFIED PLAYBACK CONTROLS */}
          <div className="unified-controls" style={{ background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 12, marginBottom: 24, border: '1px solid rgba(255,255,255,0.05)' }}>
            
            {/* Seek / Progress Timeline */}
            <div className="progress-wrap" style={{ marginBottom: 16 }}>
              {isHost ? (
                <input
                  id="seek-slider"
                  type="range"
                  min={0}
                  max={Math.max((durationMs || 1000) / 1000, 1)}
                  step={0.1}
                  value={currentTime}
                  onChange={(event) => void handleSeek(Number(event.target.value))}
                  style={{ width: '100%', marginBottom: 8 }}
                />
              ) : (
                <div className="progress-bar-bg" style={{ marginBottom: 8 }}>
                  <div className="progress-bar-fill" style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }} />
                </div>
              )}
              <div className="progress-times" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span>{formatTime(currentTime * 1000)}</span>
                <span>{formatTime(durationMs || 0)}</span>
              </div>
            </div>

            {/* Playback Buttons */}
            {isHost ? (
              <div className="player-controls" style={{ margin: 0 }}>
                <button className="icon-button" aria-label="Previous song" onClick={() => void handleAdjacentTrack(-1)} disabled={queue.length < 2}><SkipBack size={24} fill="currentColor" /></button>
                <button className="play-button" aria-label={isAudioPlaying ? 'Pause' : 'Play'} onClick={() => void handlePlayPause()} disabled={!currentItem}>
                  {isAudioPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{marginLeft:4}} />}
                </button>
                <button className="icon-button" aria-label="Next song" onClick={() => void handleAdjacentTrack(1)} disabled={queue.length < 2}><SkipForward size={24} fill="currentColor" /></button>
              </div>
            ) : (
              <div className="host-locked-pill" style={{ margin: '0 auto' }}><Users size={16} /> Controlled by Host</div>
            )}
          </div>

          <div className="volume-block">
            <label htmlFor="volume-slider">Volume</label>
            <div className="volume-row">
              <input
                id="volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
              <span>{Math.round(volume * 100)}%</span>
            </div>
          </div>
        </section>

        <div>
          <div className="sync-panel" style={{marginBottom: 32}}>
            <div className="sync-wave-bg" />
            <div className="sync-panel-head">
              <h3>Listening Together</h3>
              <div className="sync-status">
                <i className="device-sync-indicator">●</i> {listeningNow} Devices Synced
              </div>
            </div>
            <div className="device-list">
              {visibleMembers.length === 0 ? (
                <div className="empty-state compact"><p>Waiting for listeners...</p></div>
              ) : (
                visibleMembers.map((member) => (
                  <div key={member.user_id} className="device-row">
                    <div className="device-avatar">{member.display_name[0]?.toUpperCase() || 'U'}</div>
                    <div className="device-info">
                      <strong>{member.display_name} {member.user_id === userId ? '(You)' : ''}</strong>
                      <small>{member.role === 'owner' ? 'Host Device' : 'Connected Device'}</small>
                    </div>
                    {playback?.is_playing && <div className="device-sync-indicator"><Radio size={16} /></div>}
                  </div>
                ))
              )}
            </div>
          </div>

          <aside className="queue-panel">
            <div className="queue-header">
              <h3>Play Queue</h3>
              {isHost && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="primary-button" style={{ padding: '6px 12px', fontSize: '12px', height: 'auto', borderRadius: '100px' }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowSearchModal(true); }}>
                    <Search size={14} style={{ marginRight: '4px' }} /> Search Music
                  </button>
                  <label className="upload-button">
                    <Plus size={14} />ADD SONGS
                    <input type="file" accept="audio/*" multiple onChange={handleAddSong} />
                  </label>
                </div>
              )}
            </div>

          <div className="queue-list">
            {queue.length === 0 ? (
              <div className="empty-state compact"><p>No songs in the queue yet.</p></div>
            ) : (
              queue.map((item, index) => (
                <div key={item.id} className="queue-item-wrap">
                  <button className={currentItem?.id === item.id ? 'queue-item active' : 'queue-item'} onClick={() => void handleSelectTrack(item)}>
                    <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.artist || 'Local audio'}</small>
                    </div>
                    <span>{formatTime(item.duration_ms ?? 0)}</span>
                  </button>
                  {isHost && <button className="queue-remove" aria-label={`Remove ${item.title}`} onClick={() => void handleRemoveSong(item)}><X size={14} /></button>}
                </div>
              ))
            )}
          </div>

          {uploading && <div className="upload-status"><LoaderCircle className="spin" size={15} />{songReady || 'Uploading Song...'}</div>}
          {songReady && !uploading && <div className="upload-status success"><Check size={15} />{songReady}</div>}
        </aside>
        </div>
      </div>
      {isHost && showQr && (
        <Modal title="Share room" close={() => setShowQr(false)}>
          <div className="qr-modal-content">
            <QRCodeCanvas value={roomUrl} size={220} includeMargin />
            <strong>{room.code}</strong>
            <button className="primary-button full" onClick={() => void copyText(roomUrl, 'Room link copied!')}><Copy size={15} />Copy Link</button>
            <button className="secondary-button full" onClick={() => setShowQr(false)}>Close</button>
          </div>
        </Modal>
      )}
      {isHost && showSearchModal && (
        <SearchMusicModal
          close={() => setShowSearchModal(false)}
          onAddSong={async (track) => {
            await handleAddSearchResult(track);
            setShowSearchModal(false);
          }}
        />
      )}
    </div>
      {isHidden && (
        <div className="mini-player" onClick={onExpand}>
          <div className="mini-art" style={{ background: currentItem?.artwork_url ? `url(${currentItem.artwork_url}) center/cover no-repeat` : gradient }} />
          <div className="mini-info">
            <h4>{currentItem?.title || 'No song selected'}</h4>
            <p>{currentItem?.artist || 'SYNCWAVE'}</p>
          </div>
          <button className="mini-play" aria-label={isAudioPlaying ? 'Pause' : 'Play'} onClick={(e) => { e.stopPropagation(); void handlePlayPause(); }} disabled={!currentItem || (!isHost && !currentItem)}>
            {isAudioPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{marginLeft: 2}} />}
          </button>
        </div>
      )}
    </>
  );
}

function SearchMusicModal({
  close,
  onAddSong,
}: {
  close: () => void;
  onAddSong: (item: { title: string; artist: string; media_id: string; artwork_url: string | null; duration_ms: number; source_type: string }) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setLoading(true);
    setError('');
    setHasSearched(true);
    
    try {
      const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error('YOUTUBE_KEY_MISSING');
      }

      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&q=${encodeURIComponent(q)}&key=${apiKey}`);
      if (!response.ok) {
        const errorData = await response.json();
        console.error('YOUTUBE API ERROR:', errorData);
        throw new Error(errorData?.error?.message || 'Search failed');
      }
      const data = await response.json();
      setResults(data.items || []);
    } catch (err: any) {
      if (err.message === 'YOUTUBE_KEY_MISSING') {
        setError('YouTube API key is missing. Please add VITE_YOUTUBE_API_KEY to your environment variables to enable full-length YouTube playback search.');
      } else {
        console.error('SEARCH ERROR:', err);
        setError(err.message || 'Failed to load search results.');
      }
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (track: any) => {
    setAddingId(track.id.videoId);
    try {
      let fetchedDurationMs = 0;
      const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
      if (apiKey) {
        try {
          const detailRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${track.id.videoId}&key=${apiKey}`);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const isoDuration = detailData.items?.[0]?.contentDetails?.duration;
            if (isoDuration) {
              const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
              if (match) {
                const hours = parseInt(match[1] || '0', 10);
                const minutes = parseInt(match[2] || '0', 10);
                const seconds = parseInt(match[3] || '0', 10);
                fetchedDurationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
              }
            }
          }
        } catch (e) {
          console.error("Failed to fetch video duration", e);
        }
      }

      await onAddSong({
        title: track.snippet.title,
        artist: track.snippet.channelTitle,
        media_id: `https://www.youtube.com/watch?v=${track.id.videoId}`,
        artwork_url: track.snippet.thumbnails.high?.url || track.snippet.thumbnails.default?.url || null,
        duration_ms: fetchedDurationMs,
        source_type: 'youtube',
      });
    } finally {
      setAddingId(null);
    }
  };

  const suggestions = ['Baahubali songs', 'Telugu Hits', 'Arijit Singh', 'Bollywood Hits', 'Tamil Songs', 'Kesariya', 'Trending Indian songs'];

  return (
    <div className="search-modal-overlay fade-in" onClick={close}>
      <div className="search-modal-content" onClick={e => e.stopPropagation()}>
        <div className="search-modal-header">
          <h2>Search Music</h2>
          <button className="icon-button" onClick={close}><X size={20} /></button>
        </div>
        
        <div className="search-bar-wrap">
          <Search size={18} className="search-icon" />
          <input
            autoFocus
            type="text"
            placeholder="Search for songs, artists..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search(query);
            }}
          />
          {query && <button className="icon-button clear-btn" onClick={() => setQuery('')}><X size={16}/></button>}
        </div>

        <div className="search-modal-body">
          {!hasSearched && !loading && (
            <div className="search-suggestions">
              <h3>🔥 Trending Searches</h3>
              <div className="suggestion-tags">
                {suggestions.map(s => (
                  <button key={s} className="suggestion-tag" onClick={() => void search(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading && <div className="search-center-state"><LoaderCircle className="spin" size={32} /></div>}

          {error && <div className="search-center-state form-error">{error}</div>}

          {hasSearched && !loading && !error && results.length === 0 && (
            <div className="search-center-state">
              <p>No results found for "{query}"</p>
            </div>
          )}

          {hasSearched && !loading && results.length > 0 && (
            <div className="search-results-list">
              {results.map(track => (
                <div key={track.id.videoId} className="search-result-item">
                  <img src={track.snippet.thumbnails.default?.url} alt={track.snippet.title} className="search-result-art" />
                  <div className="search-result-info">
                    <h4>{track.snippet.title}</h4>
                    <p>{track.snippet.channelTitle}</p>
                  </div>
                  <button
                    className="primary-button small"
                    disabled={addingId === track.id.videoId}
                    onClick={() => void handleAdd(track)}
                    style={{ padding: '6px 12px', fontSize: '13px', minWidth: '70px' }}
                  >
                    {addingId === track.id.videoId ? <LoaderCircle className="spin" size={14} /> : <><Plus size={14} style={{marginRight:4}} /> Add</>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ARXYN root container not found.');
}

const root = (globalThis as typeof globalThis & { __arxynRoot?: ReturnType<typeof createRoot> }).__arxynRoot ?? createRoot(rootElement);
(root as ReturnType<typeof createRoot>).render(
  <AppErrorBoundary>
    <App />
    <div style={{ position: 'fixed', bottom: 10, right: 10, background: 'rgba(0,0,0,0.7)', color: 'white', padding: '4px 8px', borderRadius: 4, fontSize: 10, zIndex: 99999, pointerEvents: 'none' }}>
      v2.0 - SYNC PAUSE FIX
    </div>
  </AppErrorBoundary>,
);

(globalThis as typeof globalThis & { __arxynRoot?: ReturnType<typeof createRoot> }).__arxynRoot = root;

export default App;
