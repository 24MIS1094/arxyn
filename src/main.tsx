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

const authConfigError = 'Authentication is not configured for this deployment. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the Vercel project environment.';
const appBaseUrl = (import.meta.env.VITE_SITE_URL || import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')).replace(/\/$/, '');
const googleAuthRedirectUrl = new URL('/auth/callback', `${appBaseUrl}/`).toString();
const getAuthRedirectUrl = (path: string) => new URL(path, `${appBaseUrl}/`).toString();
const getRoomIdFromPath = (pathname: string) => {
  const match = pathname.match(/^\/room\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
};
const getRoomUrl = (id: string) => `${window.location.origin}/room/${encodeURIComponent(id)}`;
const gradient = 'linear-gradient(135deg, rgba(137, 168, 255, 0.24), rgba(255, 128, 102, 0.2) 40%, rgba(122, 89, 255, 0.18));';
const audioBucket = 'audio';
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

const getPublicStorageUrl = (path: string) => {
  if (!supabase) return path;
  if (!path || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) return path;
  try {
    const { data } = supabase.storage.from('audio').getPublicUrl(path);
    return data?.publicUrl || path;
  } catch {
    return path;
  }
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
  const initialRoomId = getRoomIdFromPath(window.location.pathname);
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
    const pendingRoomId = getRoomIdFromPath(window.location.pathname);
    if (!session && pendingRoomId) {
      sessionStorage.setItem('arxyn_pending_room_id', pendingRoomId);
    }
  }, [session]);

  useEffect(() => {
    const handlePopState = () => {
      const nextRoomId = getRoomIdFromPath(window.location.pathname);
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

    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser.user) {
      setBusy(false);
      setError('You must be signed in to join a room.');
      return;
    }

    const { data: joined, error: memberError } = await supabase.rpc('join_room', { p_room_id: room.id });

    setBusy(false);

    if (memberError || joined !== true) {
      const joinError = memberError ?? { message: 'The room join was not confirmed.' };
      logSupabaseError('join_room RPC', 'JOIN room by code', joinError);
      setError(getJoinErrorMessage(joinError));
      return;
    }

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSyncRef = useRef(0);

  const isHost = room?.host_id === userId;
  const currentItem = queue.find((item) => playback && item.media_id === playback.media_id) ?? queue[0] ?? null;
  const roomUrl = getRoomUrl(roomId);

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

  const getCurrentAudioUrl = () => currentItem ? getPublicStorageUrl(currentItem.media_id) : '';

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
    const nextSource = loadCurrentAudio();
    if (!audio || !currentItem || !nextSource) return;

    if (playback) {
      const elapsed = playback.is_playing
        ? Math.max(0, (Date.now() - Date.parse(playback.server_timestamp)) / 1000)
        : 0;
      const target = Number(playback.position_ms || 0) / 1000 + elapsed;
      const delta = Math.abs(audio.currentTime - target);
      if (delta > 0.75) {
        audio.currentTime = target;
      }
      if (playback.is_playing) {
        console.log('PLAYBACK DEBUG', {
          song: currentItem,
          audioUrl: nextSource,
          currentTime: audio.currentTime,
          readyState: audio.readyState,
          networkState: audio.networkState,
        });
        try {
          await waitForAudioReady(audio);
          await audio.play();
          setAutoplayBlocked(false);
        } catch (playError) {
          console.error('AUDIO PLAY ERROR', playError);
          setAutoplayBlocked(true);
          notify('Tap to Sync & Play');
        }
      } else {
        audio.pause();
      }
    }
  };

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

      if (roomData.host_id !== userId) {
        const { error: membershipError } = await client.rpc('join_room', { p_room_id: roomId });
        if (membershipError) {
          logSupabaseError('join_room RPC', 'JOIN room', membershipError);
          setError('Unable to join this room. Please try again.');
          return;
        }
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

      const { data: memberRows, error: memberError } = await client.from('room_members').select('*').eq('room_id', roomId);
      if (memberError) {
        logSupabaseError('room_members', 'SELECT room members', memberError);
        setMembers([]);
      } else {
        const userIds = [...new Set((memberRows ?? []).map((member) => member.user_id))];
        const { data: profileRows, error: profileError } = userIds.length
          ? await client.from('profiles').select('id, name, email').in('id', userIds)
          : { data: [], error: null };

        if (profileError) {
          logSupabaseError('profiles', 'SELECT room profiles', profileError);
        }

        const profileMap = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
        const mappedMembers = (memberRows ?? []).map((member) => ({
          user_id: member.user_id,
          role: member.role,
          joined_at: member.joined_at,
          display_name: profileMap.get(member.user_id)?.name || profileMap.get(member.user_id)?.email || 'User',
        }));
        setMembers(mappedMembers);
      }
    };

    void loadRoom();
  }, [roomId]);

  useEffect(() => {
    if (!supabase || !roomId) return;
    const client = supabase;

    const channel = client.channel(`room:${roomId}`);

    channel
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playback_state', filter: `room_id=eq.${roomId}` }, (payload) => {
        setPlayback((payload.new as PlaybackState) ?? null);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, async () => {
        const { data: memberRows } = await client.from('room_members').select('*').eq('room_id', roomId);
        const userIds = [...new Set((memberRows ?? []).map((member) => member.user_id))];
        const { data: profileRows } = userIds.length ? await client.from('profiles').select('id, name, email').in('id', userIds) : { data: [] };
        const profileMap = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
        setMembers((memberRows ?? []).map((member) => ({
          user_id: member.user_id,
          role: member.role,
          joined_at: member.joined_at,
          display_name: profileMap.get(member.user_id)?.name || profileMap.get(member.user_id)?.email || 'User',
        })));
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [roomId]);

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
        console.log('AUDIO UPLOAD DEBUG', {
          bucket: audioBucket,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          roomId,
          uploadPath,
        });
        console.log('Uploading audio to bucket:', audioBucket);
        const { data: uploadedFile, error: uploadError } = await supabase.storage.from('audio').upload(uploadPath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) {
          const errorDetails = uploadError as unknown as Record<string, unknown>;
          console.error('AUDIO STORAGE UPLOAD ERROR', {
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
            ? "Audio storage is not configured. Please create the 'audio' storage bucket in Supabase."
            : uploadError.message;
          notify(message);
          setSongReady(message);
          continue;
        }

        const uploadedPath = uploadedFile?.path || uploadPath;
        const audioUrl = getPublicStorageUrl(uploadedPath);
        console.log('AUDIO UPLOAD RESPONSE', uploadedFile);
        console.log('Uploaded audio path:', uploadedPath);
        console.log('AUDIO URL', audioUrl);
        console.log('Playable audio URL:', audioUrl);

        const item: QueueItem = {
          id: crypto.randomUUID(),
          room_id: roomId,
          media_id: uploadedPath,
          title: file.name.replace(/\.[^/.]+$/, ''),
          artist: 'Local upload',
          artwork_url: null,
          position: nextPosition,
          duration_ms: 0,
          source_type: 'device_file',
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
          source_type: 'device_file',
          duration_ms: item.duration_ms,
          status: 'queued',
        }).select('id, room_id, media_id, title, artist, artwork_url, position, duration_ms, source_type, created_at, requested_by').single();

        if (insertError) {
          logSupabaseError('queue_items', 'INSERT', insertError);
          const { error: cleanupError } = await supabase.storage.from('audio').remove([uploadedPath]);
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
    const { error: storageError } = await supabase.storage.from('audio').remove([item.media_id]);
    if (storageError) {
      logSupabaseError('storage.objects (audio)', 'DELETE queue audio', storageError);
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
    const { data: audioObjects, error: listError } = await supabase.storage.from('audio').list(roomId);
    if (listError) {
      logSupabaseError('storage.objects (audio)', 'LIST room audio', listError);
    } else if (audioObjects?.length) {
      const { error: storageError } = await supabase.storage.from('audio').remove(audioObjects.map((object) => `${roomId}/${object.name}`));
      if (storageError) {
        logSupabaseError('storage.objects (audio)', 'DELETE room audio', storageError);
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
      sequence_number: (nextState.sequence_number ?? current.sequence_number ?? 0) + 1,
    };

    const { error } = await supabase.from('playback_state').upsert(payload, { onConflict: 'room_id' });
    if (error) {
      console.error('Playback sync error', error);
      notify(`Synchronization failed: ${error.message}`);
    }
  };

  const handlePlayPause = async () => {
    if (!audioRef.current || !currentItem) return;

    if (!isHost) return;
    const shouldPlay = audioRef.current.paused;
    if (shouldPlay) {
      const audioUrl = loadCurrentAudio();
      if (!audioUrl) {
        const message = 'Unable to play this audio: no playable Storage URL is available.';
        console.error('AUDIO PLAY ERROR', message);
        notify(message);
        return;
      }
      const audio = audioRef.current;
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : Number(playback?.position_ms || 0) / 1000;
      audio.currentTime = currentTime;
      console.log('PLAYBACK DEBUG', {
        song: currentItem,
        audioUrl,
        currentTime: audio.currentTime,
        readyState: audio.readyState,
        networkState: audio.networkState,
      });
      try {
        await waitForAudioReady(audio);
        await audio.play();
        setAutoplayBlocked(false);
      } catch (playError) {
        console.error('AUDIO PLAY ERROR', playError);
        setAutoplayBlocked(true);
        notify(`Unable to play this audio: ${playError instanceof Error ? playError.message : String(playError)}`);
        return;
      }
      await updatePlayback({
        media_id: currentItem.media_id,
        title: currentItem.title,
        artist: currentItem.artist,
        artwork_url: currentItem.artwork_url,
        is_playing: true,
        position_ms: Math.round(currentTime * 1000),
        server_timestamp: new Date().toISOString(),
        sequence_number: (playback?.sequence_number ?? 0) + 1,
      });
    } else {
      const currentTime = Number.isFinite(audioRef.current.currentTime) ? audioRef.current.currentTime : Number(playback?.position_ms || 0) / 1000;
      await updatePlayback({
        media_id: currentItem.media_id,
        title: currentItem.title,
        artist: currentItem.artist,
        artwork_url: currentItem.artwork_url,
        is_playing: false,
        position_ms: Math.round(currentTime * 1000),
        server_timestamp: new Date().toISOString(),
        sequence_number: (playback?.sequence_number ?? 0) + 1,
      });
      audioRef.current.pause();
    }
  };

  const handleSyncAndPlay = async () => {
    const audio = audioRef.current;
    const source = loadCurrentAudio();
    if (!audio || !source || !playback || !currentItem) return;
    const elapsed = playback.is_playing
      ? Math.max(0, (Date.now() - Date.parse(playback.server_timestamp)) / 1000)
      : 0;
    audio.currentTime = Number(playback.position_ms || 0) / 1000 + elapsed;
    console.log('PLAYBACK DEBUG', {
      song: currentItem,
      audioUrl: source,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      networkState: audio.networkState,
    });
    try {
      await waitForAudioReady(audio);
      await audio.play();
      setAutoplayBlocked(false);
    } catch (playError) {
      console.error('AUDIO PLAY ERROR', playError);
      notify(`Unable to play this audio: ${playError instanceof Error ? playError.message : String(playError)}`);
    }
  };

  const handleSelectTrack = async (item: QueueItem) => {
    if (!isHost) return;
    await updatePlayback({
      media_id: item.media_id,
      title: item.title,
      artist: item.artist,
      artwork_url: item.artwork_url,
      is_playing: false,
      position_ms: 0,
      server_timestamp: new Date().toISOString(),
      sequence_number: (playback?.sequence_number ?? 0) + 1,
    });
  };

  const handleAdjacentTrack = async (direction: -1 | 1) => {
    if (!isHost || queue.length < 2 || !currentItem) return;
    const currentIndex = queue.findIndex((item) => item.id === currentItem.id);
    const nextItem = queue[currentIndex + direction];
    if (!nextItem) return;

    const source = getPublicStorageUrl(nextItem.media_id);
    const audio = audioRef.current;
    if (!audio || !source || source.startsWith('blob:') || source.startsWith('file:')) return;

    audio.src = source;
    audio.load();
    setCurrentTime(0);
    setAudioDuration(0);
    try {
      await waitForAudioReady(audio);
      await audio.play();
      setAutoplayBlocked(false);
      await updatePlayback({
        media_id: nextItem.media_id,
        title: nextItem.title,
        artist: nextItem.artist,
        artwork_url: nextItem.artwork_url,
        is_playing: true,
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
      is_playing: !audioRef.current.paused,
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

  return (
    <div className="room-content fade-in">
      <div className="room-header">
        <div>
          <div className="breadcrumb"><span>ARXYN /</span> <span>{getDisplayRoomName(room)}</span></div>
          <h1>{room.name}</h1>
          <div className="room-meta">
            <span className="room-state"><i />{members.length} connected</span>
            <span><Users size={14} /> {room.max_participants} max</span>
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
              <p className="muted">{currentItem?.artist || 'Awaiting the host to add tracks'}</p>
            </div>
            <button className="like-button" aria-label="Like song">?</button>
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

          {autoplayBlocked && <button className="secondary-button full" onClick={() => void handleSyncAndPlay()}>Tap to Sync &amp; Play</button>}

          <div className="range-block">
            <label htmlFor="seek-slider">Seek</label>
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
