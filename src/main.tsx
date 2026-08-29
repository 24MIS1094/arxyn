import { type ChangeEvent, type FormEvent, Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, ArrowUpRight, Check, Copy, Home as HomeIcon, LoaderCircle, LogOut, Menu, Music2, Pause, Play, Plus, Radio, Search, Settings, Share2, SkipBack, SkipForward, Users, X } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import './index.css';

type View = 'home' | 'rooms' | 'profile' | 'settings' | 'room';

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

const getExpectedPlaybackPosition = (state: PlaybackState | null) => {
  if (!state) return 0;
  const positionMs = Number(state.position_ms ?? 0);
  const timestampMs = Date.parse(state.server_timestamp ?? new Date().toISOString());
  if (!Number.isFinite(timestampMs)) return positionMs / 1000;
  const elapsedSeconds = state.is_playing ? (Date.now() - timestampMs) / 1000 : 0;
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
        <div className="auth-mobile-brand">ARXYN</div>
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
        <div className="brand" aria-label="ARXYN brand">
          <span className="brand-mark"><Radio size={17} /></span>
          <span>AR<span className="logo-x">X</span>YN</span>
        </div>

        <div className="profile-chip">
          <div className="avatar avatar-ra">{name[0]?.toUpperCase() || 'A'}</div>
          <div>
            <strong>{name}</strong>
            <small>{session.user.email}</small>
          </div>
        </div>

        <nav className="nav-main" aria-label="Main navigation">
          <button className={view === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setView('home')}>
            <HomeIcon size={18} />Home
          </button>
          <button className={view === 'rooms' ? 'nav-item active' : 'nav-item'} onClick={() => setView('rooms')}>
            <Music2 size={18} />Rooms
          </button>
          <button className={view === 'profile' ? 'nav-item active' : 'nav-item'} onClick={() => setView('profile')}>
            <Users size={18} />Profile
          </button>
          <button className={view === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setView('settings')}>
            <Settings size={18} />Settings
          </button>
        </nav>

        <div className="sidebar-bottom">
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
          <div className="mobile-brand">ARXYN</div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">�</button>
            <div className="avatar avatar-ra">{name[0]?.toUpperCase() || 'A'}</div>
          </div>
        </header>

        {view === 'home' && <Home setModal={setModal} openRoom={openRoom} userId={session.user.id} />}
        {view === 'rooms' && <Rooms userId={session.user.id} setModal={setModal} openRoom={openRoom} />}
        {view === 'profile' && <Profile user={session.user} logout={logout} notify={notify} />}
        {view === 'settings' && <SettingsView dark={dark} setDark={setDark} logout={logout} />}
        {view === 'room' && roomId && <Room roomId={roomId} userId={session.user.id} notify={notify} onRoomDeleted={onRoomDeleted} />}
      </main>

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

  return (
    <div className="content fade-in">
      <div className="greeting-row">
        <div>
          <p className="eyebrow">LISTEN TOGETHER</p>
          <h1>Listen Together.</h1>
          <p className="muted">Create a room, invite your friends, and experience music in sync.</p>
        </div>

        <div className="quick-actions">
          <button className="primary-button" onClick={() => setModal('create')}>
            <Plus size={18} />CREATE ROOM
          </button>
          <button className="secondary-button" onClick={() => setModal('join')}>
            <Search size={17} />JOIN ROOM
          </button>
        </div>
      </div>

      <section className="home-grid">
        <div className="hero-panel">
          <div className="hero-topline">ARXYN / LIVE ROOMS</div>
          <h2>Premium listening rooms for your people.</h2>
          <p>Host the room, add your local songs, and keep everyone aligned on the same timeline.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => setModal('create')}>Create Your Room</button>
            <button className="secondary-button" onClick={() => setModal('join')}>Join with Code</button>
          </div>
        </div>

        <div className="mini-panel">
          <p className="eyebrow">ROOM STATUS</p>
          <div className="mini-stat">
            <strong>{loading ? '...' : rooms.length}</strong>
            <span>rooms</span>
          </div>
          <div className="mini-stat">
            <strong>{rooms.length > 0 ? 'Live' : 'Ready'}</strong>
            <span>sync state</span>
          </div>
        </div>
      </section>

      <section className="room-collections">
        <div className="surface-section">
          <div className="section-head">
            <h3>Recent Rooms</h3>
            <button className="text-link" onClick={() => setModal('join')}>Join room</button>
          </div>

          {loading ? (
            <div className="empty-state"><LoaderCircle className="spin" size={22} />Loading rooms</div>
          ) : rooms.length === 0 ? (
            <div className="empty-state">
              <Radio size={26} />
              <h4>No rooms yet</h4>
              <p>Start with your first shared listening room.</p>
              <button className="primary-button" onClick={() => setModal('create')}>Create Your First Room</button>
            </div>
          ) : (
            <div className="mini-card-grid">
              {rooms.slice(0, 3).map((room) => (
                <button key={room.id} className="mini-room-card" onClick={() => openRoom(room.id)}>
                  <div className="card-art" style={{ background: gradient }} />
                  <div>
                    <h4>{room.name}</h4>
                    <small>{room.code}</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="surface-section">
          <div className="section-head">
            <h3>My Rooms</h3>
            <button className="text-link" onClick={() => setModal('create')}>New room</button>
          </div>

          {loading ? (
            <div className="empty-state"><LoaderCircle className="spin" size={22} />Loading rooms</div>
          ) : rooms.length === 0 ? (
            <div className="empty-state compact">
              <p>No rooms yet</p>
            </div>
          ) : (
            <div className="list-stack">
              {rooms.map((room) => (
                <button key={room.id} className="room-row" onClick={() => openRoom(room.id)}>
                  <div className="room-row-meta">
                    <strong>{room.name}</strong>
                    <span>{room.code} � {room.max_participants} max</span>
                  </div>
                  <span className="badge">{room.visibility}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
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
    <Modal title="Create room" close={close}>
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
    <Modal title="Join room" close={close}>
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

function Room({ roomId, userId, notify, onRoomDeleted }: { roomId: string; userId: string; notify: (text: string) => void; onRoomDeleted: () => void }) {
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
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('connected');
  const [volume, setVolume] = useState(0.8);
  const [profileName, setProfileName] = useState('You');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSyncRef = useRef(0);
  const scheduledPlayTimeoutRef = useRef<number | null>(null);
  const latestPlaybackStateRef = useRef<PlaybackState | null>(null);
  const lastSequenceNumberRef = useRef<number | null>(null);
  const lastProcessedSequenceRef = useRef<number | null>(null);
  const roomChannelRef = useRef<any>(null);

  const isHost = room?.host_id === userId;
  const currentItem = queue.find((item) => playback && item.media_id === playback.media_id) ?? queue[0] ?? null;
  const roomUrl = getRoomUrl(roomId);

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

  const sendRealtimePlaybackCommand = async (command: 'PLAY' | 'PAUSE' | 'SEEK' | 'SONG_CHANGE', positionMs: number) => {
    if (!supabase || !roomId) return;
    const channel = roomChannelRef.current;
    if (!channel) {
      console.warn('No room channel available for playback command');
      return;
    }

    const payload = {
      command,
      roomId,
      position_ms: positionMs,
      timestamp_ms: Date.now(),
      commandId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };

    console.log(command === 'PLAY' ? 'HOST PLAY SENT' : 'HOST PAUSE SENT', payload);
    await channel.send({
      type: 'broadcast',
      event: 'playback-command',
      payload,
    });
  };

  const applyRemotePlaybackState = (state: PlaybackState) => {
    latestPlaybackStateRef.current = state;
    const audio = audioRef.current;

    if (state.is_playing === false) {
      console.log('AUTHORITATIVE PAUSE RECEIVED', state);
      clearScheduledPlay();
      if (audio) {
        audio.pause();
        audio.playbackRate = 1;
        audio.currentTime = Number(state.position_ms ?? 0) / 1000;
        setCurrentTime(audio.currentTime);
        setIsAudioPlaying(false);
        console.log('FOLLOWER PAUSE COMMAND RECEIVED', state);
        console.log('AUDIO SUCCESSFULLY PAUSED', {
          roomId,
          media_id: state.media_id,
          positionSeconds: audio.currentTime,
          sequenceNumber: state.sequence_number,
        });
      }
      return;
    }

    if (audio && audio.paused) {
      const expectedPosition = getExpectedPlaybackPosition(state);
      if (Number.isFinite(expectedPosition)) {
        audio.currentTime = expectedPosition;
      }
      void audio.play().catch(() => {
        setAutoplayBlocked(true);
      });
    }
  };

  const handleRemotePause = (state: PlaybackState) => {
    console.log('REMOTE PAUSE RECEIVED', state);
    applyRemotePlaybackState(state);
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

  const loadCurrentAudio = () => {
    const audio = audioRef.current;
    const nextSource = getCurrentAudioUrl();
    if (!audio || !nextSource || nextSource.startsWith('blob:') || nextSource.startsWith('file:')) return '';

    if (audio.src !== nextSource) {
      audio.src = nextSource;
      setCurrentTime(0);
      setAudioDuration(0);
      audio.load();
    }
    return nextSource;
  };

  const waitForAudioReady = (audio: HTMLAudioElement) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const handleReady = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('The audio source could not be loaded.'));
      };
      const cleanup = () => {
        audio.removeEventListener('canplay', handleReady);
        audio.removeEventListener('canplaythrough', handleReady);
        audio.removeEventListener('error', handleError);
      };
      audio.addEventListener('canplay', handleReady);
      audio.addEventListener('canplaythrough', handleReady);
      audio.addEventListener('error', handleError);
    });
  };

  const syncActiveSource = async () => {
    const audio = audioRef.current;
    const currentPlayback = latestPlaybackStateRef.current ?? playback;
    if (!audio || !currentItem || !currentPlayback || isHost) return;

    const nextSource = getCurrentAudioUrl();
    if (!nextSource || nextSource.startsWith('blob:') || nextSource.startsWith('file:')) return;
    if (audio.src !== nextSource) {
      audio.src = nextSource;
      audio.load();
      setCurrentTime(0);
      setAudioDuration(0);
    }

    if (!currentPlayback.is_playing) {
      handleRemotePause(currentPlayback);
      return;
    }

    const expectedPosition = getExpectedPlaybackPosition(currentPlayback);
    if (!Number.isFinite(expectedPosition)) return;

    const delta = Math.abs(audio.currentTime - expectedPosition);
    if (delta > 0.5) {
      audio.currentTime = expectedPosition;
    }

    try {
      await waitForAudioReady(audio);
      if (audio.paused) {
        await audio.play();
      }
      setAutoplayBlocked(false);
    } catch (playError) {
      console.error('AUDIO PLAY ERROR', playError);
      setAutoplayBlocked(true);
      notify('Tap to Sync & Play');
    }
  };

  useEffect(() => {
    if (!playback || !currentItem || isHost) return;
    const audio = audioRef.current;
    if (!audio) return;

    const latestState = latestPlaybackStateRef.current ?? playback;
    if (!latestState || latestState.is_playing === false) {
      return;
    }

    const expectedPosition = getExpectedPlaybackPosition(latestState);
    if (!Number.isFinite(expectedPosition)) return;

    const drift = expectedPosition - audio.currentTime;
    if (Math.abs(drift) > 0.5) {
      audio.currentTime = expectedPosition;
      setCurrentTime(expectedPosition);
    }

    if (audio.paused) {
      void audio.play().catch(() => {
        setAutoplayBlocked(true);
      });
    }
  }, [currentItem, playback, isHost]);

  useEffect(() => {
    if (!playback || !currentItem || isHost) return;

    const syncInterval = window.setInterval(() => {
      const state = latestPlaybackStateRef.current ?? playback;
      const audio = audioRef.current;
      if (!audio) return;

      if (!state || state.is_playing === false) {
        return;
      }

      const expectedPosition = getExpectedPlaybackPosition(state);
      const drift = expectedPosition - audio.currentTime;

      if (Math.abs(drift) > 0.5) {
        audio.currentTime = expectedPosition;
        setCurrentTime(expectedPosition);
      }

      if (audio.paused) {
        void audio.play().catch(() => {
          setAutoplayBlocked(true);
        });
      }
    }, 1200);

    return () => window.clearInterval(syncInterval);
  }, [currentItem, playback, isHost]);

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
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (!supabase || !roomId) return;
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
        const command = payload.payload as { command?: string; roomId?: string; position_ms?: number; timestamp_ms?: number; commandId?: string } | undefined;
        if (!command || command.roomId !== roomId) return;

        if (command.command === 'PLAY') {
          console.log('PLAY COMMAND RECEIVED', command);
          const audio = audioRef.current;
          if (!audio) return;
          clearScheduledPlay();
          audio.currentTime = Number(command.position_ms ?? 0) / 1000;
          setCurrentTime(audio.currentTime);
          void audio.play().catch(() => setAutoplayBlocked(true));

          const nextState: PlaybackState = {
            room_id: roomId,
            media_id: currentItem?.media_id ?? playback?.media_id ?? null,
            title: currentItem?.title ?? playback?.title ?? null,
            artist: currentItem?.artist ?? playback?.artist ?? null,
            artwork_url: currentItem?.artwork_url ?? playback?.artwork_url ?? null,
            is_playing: true,
            position_ms: Number(command.position_ms ?? 0),
            server_timestamp: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sequence_number: (latestPlaybackStateRef.current?.sequence_number ?? playback?.sequence_number ?? 0) + 1,
          };

          latestPlaybackStateRef.current = nextState;
          setPlayback(nextState);
          return;
        }

        if (command.command === 'PAUSE') {
          console.log('PAUSE COMMAND RECEIVED');
          if (scheduledPlayTimeoutRef.current) {
            clearTimeout(scheduledPlayTimeoutRef.current);
            scheduledPlayTimeoutRef.current = null;
          }

          const audio = audioRef.current;
          if (!audio) return;

          audio.pause();
          audio.playbackRate = 1;
          audio.currentTime = Number(command.position_ms ?? 0) / 1000;

          const nextState: PlaybackState = {
            room_id: roomId,
            media_id: currentItem?.media_id ?? playback?.media_id ?? null,
            title: currentItem?.title ?? playback?.title ?? null,
            artist: currentItem?.artist ?? playback?.artist ?? null,
            artwork_url: currentItem?.artwork_url ?? playback?.artwork_url ?? null,
            is_playing: false,
            position_ms: Number(command.position_ms ?? 0),
            server_timestamp: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sequence_number: (latestPlaybackStateRef.current?.sequence_number ?? playback?.sequence_number ?? 0) + 1,
          };

          latestPlaybackStateRef.current = nextState;
          setCurrentTime(audio.currentTime);
          setIsAudioPlaying(false);
          setPlayback(nextState);
          console.log('FOLLOWER AUDIO PAUSED');
          return;
        }
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
        console.log('REALTIME PLAYBACK EVENT:', payload);
        if (!payload.new) return;
        const nextState = payload.new as PlaybackState;
        const nextSequence = Number(nextState.sequence_number ?? -1);
        const previousSequence = lastProcessedSequenceRef.current ?? -1;

        if (nextSequence <= previousSequence) {
          console.log('IGNORED STALE PLAYBACK UPDATE', { nextSequence, previousSequence, nextState });
          return;
        }

        lastProcessedSequenceRef.current = nextSequence;
        latestPlaybackStateRef.current = nextState;
        console.log('FOLLOWER PLAYBACK STATE', nextState);
        applyRemotePlaybackState(nextState);
        setPlayback(nextState);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'playback_state', filter: `room_id=eq.${roomId}` }, (payload) => {
        console.log('REALTIME PLAYBACK EVENT:', payload);
        if (!payload.new) return;
        const nextState = payload.new as PlaybackState;
        const nextSequence = Number(nextState.sequence_number ?? -1);
        const previousSequence = lastProcessedSequenceRef.current ?? -1;

        if (nextSequence <= previousSequence) {
          console.log('IGNORED STALE PLAYBACK UPDATE', { nextSequence, previousSequence, nextState });
          return;
        }

        lastProcessedSequenceRef.current = nextSequence;
        latestPlaybackStateRef.current = nextState;
        console.log('FOLLOWER PLAYBACK STATE', nextState);

        if (nextState.is_playing === false) {
          console.log('FOLLOWER PAUSE COMMAND RECEIVED');
          applyRemotePlaybackState(nextState);
          setPlayback(nextState);
          return;
        }

        if (isHost) {
          return;
        }

        setPlayback(nextState);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, () => {
        void loadRoomMembers(client);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          await channel.track({
            user_id: userId,
            display_name: profileName,
            joined_at: Date.now(),
            is_host: room?.host_id === userId,
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
  }, [roomId, userId, profileName, room?.host_id]);

  useEffect(() => {
    if (playback && currentItem && audioRef.current) {
      syncActiveSource();
    }
  }, [currentItem, playback]);

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
        });
      } else {
        audioRef.current?.pause();
        await updatePlayback({ media_id: null, title: null, artist: null, artwork_url: null, is_playing: false, position_ms: 0, server_timestamp: new Date().toISOString() });
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

  const updatePlayback = async (nextState: Partial<PlaybackState>) => {
    if (!supabase || !roomId || !isHost) return;
    const now = new Date().toISOString();
    const current = playback ?? {
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

    const nextSequence = (nextState.sequence_number ?? current.sequence_number ?? 0) + 1;
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

    const { error } = await supabase.from('playback_state').upsert(payload, { onConflict: 'room_id' });
    if (error) {
      console.error('Playback sync error', error);
      notify(`Synchronization failed: ${error.message}`);
      return;
    }

    latestPlaybackStateRef.current = payload as PlaybackState;
    lastSequenceNumberRef.current = nextSequence;
    lastProcessedSequenceRef.current = nextSequence;
    setPlayback(payload as PlaybackState);
  };

  const handleHostPause = async () => {
    if (!supabase || !audioRef.current || !roomId || !isHost) return;

    const positionMs = Math.round(audioRef.current.currentTime * 1000);
    const serverTimestamp = new Date().toISOString();
    const nextSequence = (lastSequenceNumberRef.current ?? latestPlaybackStateRef.current?.sequence_number ?? playback?.sequence_number ?? 0) + 1;
    const playbackState = {
      is_playing: false,
      position_ms: positionMs,
      server_timestamp: serverTimestamp,
      sequence_number: nextSequence,
      updated_at: serverTimestamp,
    };

    console.log('HOST PAUSE SENT', { roomId, position_ms: positionMs, timestamp_ms: Date.now(), commandId: `${Date.now()}-${Math.random().toString(16).slice(2)}` });
    clearScheduledPlay();
    await sendRealtimePlaybackCommand('PAUSE', positionMs);
    console.log('HOST PAUSE BUTTON CLICKED');
    console.log('HOST WRITING PAUSE STATE', playbackState);

    const { data, error } = await supabase
      .from('playback_state')
      .update({
        is_playing: false,
        position_ms: positionMs,
        server_timestamp: serverTimestamp,
        sequence_number: nextSequence,
        updated_at: serverTimestamp,
      })
      .eq('room_id', roomId)
      .select();

    console.log('HOST PAUSE DATABASE RESULT', { data, error });

    if (error) {
      console.error('HOST PAUSE DATABASE ERROR', error);
      notify(`Unable to pause playback: ${error.message}`);
      return;
    }

    audioRef.current.pause();
    audioRef.current.playbackRate = 1;
    audioRef.current.currentTime = positionMs / 1000;
    setCurrentTime(positionMs / 1000);
    setIsAudioPlaying(false);
    lastSequenceNumberRef.current = nextSequence;
    lastProcessedSequenceRef.current = nextSequence;
    latestPlaybackStateRef.current = {
      ...(playback ?? {
        room_id: roomId,
        media_id: currentItem?.media_id ?? null,
        title: currentItem?.title ?? null,
        artist: currentItem?.artist ?? null,
        artwork_url: currentItem?.artwork_url ?? null,
        is_playing: false,
        position_ms: 0,
        server_timestamp: serverTimestamp,
        updated_at: serverTimestamp,
        sequence_number: 0,
      }),
      ...playbackState,
      room_id: roomId,
      media_id: currentItem?.media_id ?? playback?.media_id ?? null,
      title: currentItem?.title ?? playback?.title ?? null,
      artist: currentItem?.artist ?? playback?.artist ?? null,
      artwork_url: currentItem?.artwork_url ?? playback?.artwork_url ?? null,
    };
    setPlayback(latestPlaybackStateRef.current);
  };

  const handlePlayPause = async () => {
    if (!audioRef.current || !currentItem || !isHost) return;

    const audio = audioRef.current;
    clearScheduledPlay();
    const shouldPlay = audio.paused;

    if (shouldPlay) {
      const audioUrl = getCurrentAudioUrl();
      if (!audioUrl) {
        const message = 'Unable to play this audio: no playable Storage URL is available.';
        console.error('AUDIO PLAY ERROR', message);
        notify(message);
        return;
      }

      if (audio.src !== audioUrl) {
        audio.src = audioUrl;
        audio.load();
      }

      const nextPosition = Number.isFinite(audio.currentTime) ? audio.currentTime : Number(playback?.position_ms || 0) / 1000;
      audio.currentTime = nextPosition;

      try {
        await waitForAudioReady(audio);
        console.log('HOST PLAY SENT', { roomId, position_ms: Math.round(audio.currentTime * 1000), timestamp_ms: Date.now() });
        await sendRealtimePlaybackCommand('PLAY', Math.round(audio.currentTime * 1000));
        await audio.play();
        setAutoplayBlocked(false);
      } catch (playError) {
        console.error('AUDIO PLAY ERROR', playError);
        setAutoplayBlocked(true);
        notify(`Unable to play this audio: ${playError instanceof Error ? playError.message : String(playError)}`);
        return;
      }

      const hostTimestamp = new Date().toISOString();
      const sequenceNumber = (latestPlaybackStateRef.current?.sequence_number ?? playback?.sequence_number ?? 0) + 1;
      await updatePlayback({
        media_id: currentItem.media_id,
        title: currentItem.title,
        artist: currentItem.artist,
        artwork_url: currentItem.artwork_url,
        is_playing: true,
        position_ms: Math.round(audio.currentTime * 1000),
        server_timestamp: hostTimestamp,
        sequence_number: sequenceNumber,
      });
    } else {
      await handleHostPause();
    }
  };

  const handleSyncAndPlay = async () => {
    const audio = audioRef.current;
    if (!audio || !playback || !currentItem) return;

    clearScheduledPlay();
    const latestState = latestPlaybackStateRef.current ?? playback;
    if (!latestState.is_playing) {
      handleRemotePause(latestState);
      return;
    }

    const source = getCurrentAudioUrl();
    if (!source || source.startsWith('blob:') || source.startsWith('file:')) return;
    if (audio.src !== source) {
      audio.src = source;
      audio.load();
    }

    const expectedPosition = getExpectedPlaybackPosition(latestState);
    audio.currentTime = expectedPosition;

    try {
      await waitForAudioReady(audio);
      if (latestState.is_playing) {
        await audio.play();
      } else {
        audio.pause();
      }
      setAutoplayBlocked(false);
    } catch (playError) {
      console.error('AUDIO PLAY ERROR', playError);
      notify(`Unable to play this audio: ${playError instanceof Error ? playError.message : String(playError)}`);
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
    });
  };

  const handleAdjacentTrack = async (direction: -1 | 1) => {
    if (!isHost || queue.length < 2 || !currentItem) return;
    const currentIndex = queue.findIndex((item) => item.id === currentItem.id);
    const nextItem = queue[currentIndex + direction];
    if (!nextItem) return;

    const source = getQueueAudioUrl(nextItem);
    const audio = audioRef.current;
    if (!audio || !source || source.startsWith('blob:') || source.startsWith('file:')) return;

    const shouldKeepPlaying = playback?.is_playing ?? false;
    audio.src = source;
    audio.load();
    setCurrentTime(0);
    setAudioDuration(0);
    try {
      await waitForAudioReady(audio);
      if (shouldKeepPlaying) {
        await audio.play();
      } else {
        audio.pause();
      }
      setAutoplayBlocked(false);
      await updatePlayback({
        media_id: nextItem.media_id,
        title: nextItem.title,
        artist: nextItem.artist,
        artwork_url: nextItem.artwork_url,
        is_playing: shouldKeepPlaying,
        position_ms: 0,
        server_timestamp: new Date().toISOString(),
      });
    } catch (playError) {
      console.error('AUDIO PLAY ERROR', playError);
      setAutoplayBlocked(true);
      notify(`Unable to play this audio: ${playError instanceof Error ? playError.message : String(playError)}`);
    }
  };

  const handleSeek = async (value: number) => {
    if (!audioRef.current || !isHost) return;
    const seekTime = value;
    audioRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
    await updatePlayback({
      media_id: currentItem?.media_id ?? null,
      title: currentItem?.title ?? null,
      artist: currentItem?.artist ?? null,
      artwork_url: currentItem?.artwork_url ?? null,
      is_playing: playback?.is_playing ?? !audioRef.current.paused,
      position_ms: Math.round(seekTime * 1000),
      server_timestamp: new Date().toISOString(),
    });
  };

  const handleTimeUpdate = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    if (!isHost) return;
    const positionInfo = Math.round(audio.currentTime * 1000);
    if (Date.now() - lastSyncRef.current > 1500) {
      lastSyncRef.current = Date.now();
      await updatePlayback({
        media_id: currentItem?.media_id ?? null,
        title: currentItem?.title ?? null,
        artist: currentItem?.artist ?? null,
        artwork_url: currentItem?.artwork_url ?? null,
        is_playing: !audio.paused,
        position_ms: positionInfo,
        server_timestamp: new Date().toISOString(),
        sequence_number: (playback?.sequence_number ?? 0) + 1,
      });
    }
  };

  if (error) {
    return <div className="content"><div className="empty-state"><Radio size={26} /><h3>Room unavailable</h3><p>{error}</p></div></div>;
  }

  if (!room) {
    return <div className="content"><div className="empty-state"><LoaderCircle className="spin" size={24} />Loading room</div></div>;
  }

  const durationMs = audioDuration || (currentItem?.duration_ms ?? 0);
  const progress = (currentTime / Math.max(durationMs / 1000, 1)) * 100;
  const listeningNow = presenceUsers.length || members.length || 1;

  return (
    <div className="room-content fade-in">
      <div className="room-header">
        <div>
          <div className="breadcrumb"><span>ARXYN /</span> <span>{getDisplayRoomName(room)}</span></div>
          <h1>{room.name}</h1>
          <div className="room-meta">
            <span className={`room-state ${connectionStatus === 'connected' ? 'online' : connectionStatus === 'reconnecting' ? 'reconnecting' : 'offline'}`}><i />{connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}</span>
            <span><Users size={14} /> {listeningNow} listening</span>
            <span className="code-box">{room.code}</span>
          </div>
        </div>

        <div className="header-actions">
          <button className="secondary-button" onClick={() => void copyText(room.code, 'Room code copied!')}> <Copy size={15} />Copy Code</button>
          <button className="secondary-button" onClick={() => void handleShareRoom()}>
            <Share2 size={15} />Share Room
          </button>
          {isHost && <button className="danger-button" onClick={() => void handleDeleteRoom()}>Delete Room</button>}
          <button className="secondary-button" onClick={() => setShowQr(true)}>Show QR</button>
        </div>
      </div>

      <div className="presence-panel panel">
        <div className="panel-head">
          <h3>Listening now</h3>
          <span className="presence-count">{listeningNow} online</span>
        </div>
        <div className="presence-list">
          {presenceUsers.length ? presenceUsers.map((presenceUser) => (
            <div key={presenceUser.user_id} className={`presence-item ${presenceUser.user_id === userId ? 'self' : ''}`}>
              <span className="presence-dot" />
              <div className="presence-meta">
                <strong>{presenceUser.display_name}</strong>
                <small>{presenceUser.is_host || presenceUser.user_id === room.host_id ? 'HOST' : 'LISTENING'}</small>
              </div>
            </div>
          )) : (
            <div className="empty-state compact"><p>No listeners connected yet.</p></div>
          )}
        </div>
      </div>

      <div className="room-layout">
        <section className="panel player-panel">
          <div className="player-art" style={{ background: currentItem?.artwork_url ? `url(${currentItem.artwork_url}) center/cover no-repeat` : gradient }}>
            <div className="art-overlay">
              <span>{room.visibility}</span>
              <span className="art-more">LIVE</span>
            </div>
          </div>

          <div className="track-info">
            <div>
              <p className="eyebrow">NOW PLAYING</p>
              <h2>{currentItem?.title || 'No song selected'}</h2>
              <p className="muted">{currentItem?.artist || 'Awaiting the host to add tracks'} · <span>{room.name}</span></p>
            </div>
            <button className="like-button" aria-label="Like song">?</button>
          </div>

          <div className="status-row">
            <span className={`status-pill ${playback?.is_playing ? 'playing' : 'paused'}`}>{playback?.is_playing ? '🟢 Playing' : '⏸ Paused'}</span>
            <span className="status-pill muted-pill">{isHost ? 'Host control' : 'Synchronized with Host'}</span>
          </div>

          <div className="progress-wrap">
            <div className="progress-bar"><span style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }} /></div>
            <div className="progress-times">
              <span>{formatTime(currentTime * 1000)}</span>
              <span>{formatTime(durationMs || 0)}</span>
            </div>
          </div>

          <div className="player-controls">
            <button className="icon-button small" aria-label="Previous song" onClick={() => void handleAdjacentTrack(-1)} disabled={!isHost || queue.length < 2}><SkipBack size={18} /></button>
            <button className="play-button" aria-label={isAudioPlaying ? 'Pause' : 'Play'} onClick={() => void handlePlayPause()} disabled={!isHost || !currentItem}>
              {isAudioPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="icon-button small" aria-label="Next song" onClick={() => void handleAdjacentTrack(1)} disabled={!isHost || queue.length < 2}><SkipForward size={18} /></button>
          </div>

          {!isHost && <div className="host-locked">Controlled by Host</div>}

          <div className="range-block">
            <div className="range-header">
              <label htmlFor="seek-slider">Seek</label>
              <span>{formatTime(currentTime * 1000)} / {formatTime(durationMs || 0)}</span>
            </div>
            <input
              id="seek-slider"
              type="range"
              min={0}
              max={Math.max(durationMs / 1000, 1)}
              step={0.1}
              value={currentTime}
              onChange={(event) => void handleSeek(Number(event.target.value))}
              disabled={!isHost}
            />
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

          {autoplayBlocked && <button className="secondary-button full" onClick={() => void handleSyncAndPlay()}>Tap to Sync &amp; Play</button>}

          <audio
            ref={audioRef}
            onLoadedMetadata={(event) => {
              setAudioDuration((event.currentTarget.duration || 0) * 1000);
              setCurrentTime(event.currentTarget.currentTime || 0);
            }}
            onTimeUpdate={handleTimeUpdate}
            onCanPlay={() => console.log('AUDIO CAN PLAY', audioRef.current?.src)}
            onPlay={() => {
              setIsAudioPlaying(true);
              console.log('AUDIO PLAY', audioRef.current?.src);
            }}
            onPause={() => {
              setIsAudioPlaying(false);
              console.log('AUDIO PAUSE', audioRef.current?.src);
            }}
            onWaiting={() => console.log('AUDIO WAITING', audioRef.current?.src)}
            onCanPlayThrough={() => console.log('AUDIO CAN PLAY THROUGH', audioRef.current?.src)}
            onError={(event) => {
              const audio = event.currentTarget;
              console.error('HTML AUDIO ERROR', {
                src: audio.src,
                error: audio.error,
                code: audio.error?.code,
                message: audio.error?.message,
              });
              notify(`Unable to play this audio: ${audio.error?.message || 'The audio file could not be loaded.'}`);
            }}
            onEnded={() => {
              setIsAudioPlaying(false);
              void handleAdjacentTrack(1);
            }}
          />
        </section>

        <aside className="panel queue-panel">
          <div className="panel-head">
            <h3>Play Queue</h3>
            {isHost && (
              <label className="upload-button">
                <Plus size={14} />ADD SONGS
                <input type="file" accept="audio/*" multiple onChange={handleAddSong} />
              </label>
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

        <aside className="panel participants-panel">
          <div className="panel-head">
            <h3>Connected Devices</h3>
            <span className="badge subtle">{members.length} people connected</span>
          </div>

          <div className="member-list">
            {members.length === 0 ? (
              <div className="empty-state compact"><p>Waiting for the first participant.</p></div>
            ) : (
              members.map((member) => (
                <div key={member.user_id} className="member-row">
                  <div className="avatar tiny">{member.display_name[0]?.toUpperCase() || 'U'}</div>
                  <div>
                    <strong>{member.display_name}</strong>
                    <small>{member.role === 'owner' ? 'HOST' : 'USER'}</small>
                  </div>
                  <span className="online-dot" aria-label="online" />
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
      {showQr && (
        <Modal title="Share room" close={() => setShowQr(false)}>
          <div className="qr-modal-content">
            <QRCodeCanvas value={roomUrl} size={220} includeMargin />
            <strong>{room.code}</strong>
            <button className="primary-button full" onClick={() => void copyText(roomUrl, 'Room link copied!')}><Copy size={15} />Copy Link</button>
            <button className="secondary-button full" onClick={() => setShowQr(false)}>Close</button>
          </div>
        </Modal>
      )}
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
  </AppErrorBoundary>,
);

(globalThis as typeof globalThis & { __arxynRoot?: ReturnType<typeof createRoot> }).__arxynRoot = root;

export default App;
