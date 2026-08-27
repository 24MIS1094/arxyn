import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight, BarChart3, Check, ChevronDown, Copy, Headphones, Home, LockKeyhole,
  MessageCircle, MoreHorizontal, Music2, Pause, Play, Plus, Radio, Search, Send,
  Settings, Share2, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Users, X, Zap, FolderOpen, Youtube, Link2
} from 'lucide-react';
import './index.css';

type View = 'home' | 'room' | 'rooms' | 'analytics';
type Modal = 'create' | 'join' | 'source' | null;

const artwork = [
  'linear-gradient(135deg, #e78367 0%, #45352b 48%, #d4bd7b 100%)',
  'linear-gradient(145deg, #86a997 0%, #1d2d2d 50%, #d37f62 100%)',
  'linear-gradient(135deg, #d7a769 0%, #283d38 48%, #759e91 100%)',
  'linear-gradient(145deg, #7d8fba 0%, #252b43 48%, #d37d66 100%)',
];

const queue = [
  { title: 'Midnight City', artist: 'M83', by: 'Aarav', votes: 18, img: artwork[1], duration: '4:03' },
  { title: 'Golden', artist: 'Jill Scott', by: 'Maya', votes: 12, img: artwork[2], duration: '3:47' },
  { title: 'Borderline', artist: 'Tame Impala', by: 'Jon', votes: 9, img: artwork[3], duration: '3:59' },
];

const messages = [
  { name: 'Maya', text: 'this mix is immaculate ✨', time: 'now', color: '#e6a36a' },
  { name: 'Aarav', text: 'Midnight City next please!', time: '1m', color: '#a3c7b7' },
  { name: 'ARXYN', text: 'Now playing Electric Feel', time: '2m', system: true },
  { name: 'Jon', text: 'everyone is so locked in 🔥', time: '3m', color: '#d88773' },
];

function App() {
  const [view, setView] = useState<View>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [playing, setPlaying] = useState(true);
  const [dark, setDark] = useState(true);
  const [roomName, setRoomName] = useState('');
  const [chatText, setChatText] = useState('');
  const [chat, setChat] = useState(messages);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');
  const [googleConnected, setGoogleConnected] = useState(false);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  };

  const sendMessage = () => {
    if (!chatText.trim()) return;
    setChat([...chat, { name: 'Rahul', text: chatText.trim(), time: 'now', color: '#db7b64' }]);
    setChatText('');
  };

  const copyCode = () => {
    navigator.clipboard?.writeText('A7K92X');
    setCopied(true);
    notify('Room code copied');
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={dark ? 'app' : 'app light'}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Radio size={17} /></span><span>AR<span className="logo-x">X</span>YN</span></div>
        <div className="profile-chip"><div className="avatar avatar-ra" >R</div><div><strong>Rahul Anand</strong><small>Personal space</small></div><ChevronDown size={15} /></div>
        <nav className="nav-main" aria-label="Main navigation">
          <button className={view === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setView('home')}><Home size={18} />Overview</button>
          <button className={view === 'rooms' ? 'nav-item active' : 'nav-item'} onClick={() => setView('rooms')}><Headphones size={18} />My rooms</button>
          <button className={view === 'analytics' ? 'nav-item active' : 'nav-item'} onClick={() => setView('analytics')}><BarChart3 size={18} />Analytics <span className="soon">PRO</span></button>
        </nav>
        <div className="sidebar-label">Your rooms <button onClick={() => setModal('create')} aria-label="Create a room"><Plus size={15}/></button></div>
        <div className="room-links"><button onClick={() => setView('room')}><span className="room-dot live-dot"/> Saturday night radio <small>12</small></button><button onClick={() => setView('room')}><span className="room-dot"/> Deep focus <small>—</small></button></div>
        <div className="sidebar-bottom"><div className="upgrade"><Sparkles size={16}/><div><strong>Make it an event</strong><small>Unlock up to 500 listeners</small></div><ArrowUpRight size={15}/></div><button className="nav-item"><Settings size={18}/>Settings</button><button className="nav-item"><div className="avatar avatar-ra mini">R</div>Profile</button></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark"><Radio size={16}/></span><span>AR<span className="logo-x">X</span>YN</span></div><div className="top-actions"><button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? '☼' : '◐'}</button><button className="icon-button notification" aria-label="Notifications"><Zap size={17}/><i/></button><div className="avatar avatar-ra">R</div></div></header>
        {view === 'home' && <HomeView setView={setView} setModal={setModal} />}
        {view === 'room' && <RoomView playing={playing} setPlaying={setPlaying} copyCode={copyCode} copied={copied} notify={notify} openSources={() => setModal('source')} chat={chat} chatText={chatText} setChatText={setChatText} sendMessage={sendMessage} />}
        {view === 'rooms' && <RoomsView setView={setView} setModal={setModal} />}
        {view === 'analytics' && <AnalyticsView />}
      </main>

      <div className="mobile-nav"><button className={view === 'home' ? 'selected' : ''} onClick={() => setView('home')}><Home size={19}/><span>Home</span></button><button className={view === 'room' ? 'selected' : ''} onClick={() => setView('room')}><Music2 size={19}/><span>Listen</span></button><button onClick={() => setModal('create')}><Plus size={21}/><span>Create</span></button><button onClick={() => setView('rooms')}><Users size={19}/><span>Rooms</span></button><button><Settings size={19}/><span>More</span></button></div>
      {modal === 'create' && <CreateModal roomName={roomName} setRoomName={setRoomName} close={() => setModal(null)} create={() => { setModal(null); setView('room'); notify('Your room is ready'); }} />}
      {modal === 'join' && <JoinModal close={() => setModal(null)} join={() => { setModal(null); setView('room'); notify('Welcome to Saturday night radio'); }} />}
      {modal === 'source' && <SourceModal close={() => setModal(null)} googleConnected={googleConnected} connectGoogle={() => { setGoogleConnected(true); notify('Google account connected'); }} notify={notify} />}
      {toast && <div className="toast"><Check size={16}/>{toast}</div>}
    </div>
  );
}

function HomeView({ setView, setModal }: { setView: (v: View) => void; setModal: (m: Modal) => void }) {
  return <div className="content fade-in"><div className="greeting-row"><div><p className="eyebrow">THURSDAY, 27 AUGUST 2026</p><h1>Welcome back, Rahul<span className="accent">.</span></h1><p className="muted">One Sound. Everyone.</p></div><div className="quick-actions"><button className="primary-button" onClick={() => setModal('create')}><Plus size={18}/>Create room</button><button className="secondary-button" onClick={() => setModal('join')}><ArrowUpRight size={18}/>Join room</button></div></div><section className="signal-banner"><div className="signal-copy"><span className="live-pill"><i/> YOUR WAVE</span><p className="brand-hero">AR<span className="logo-x">X</span>YN</p><h2>One Sound.<br/><em>Everyone.</em></h2><p>Listen together. Stay synchronized. Connect through sound.</p><button className="banner-button" onClick={() => setView('room')}>Enter your room <ArrowUpRight size={16}/></button></div><div className="wave-graphic"><div className="wave-orbit orbit-one"/><div className="wave-orbit orbit-two"/><div className="wave-center"><Radio size={28}/></div><div className="wave-label"><span>12</span><small>connected now</small></div></div></section><div className="section-heading"><h3>Jump back in</h3><button onClick={() => setView('rooms')}>View all <ArrowUpRight size={14}/></button></div><div className="room-grid"><RoomCard featured onClick={() => setView('room')} /><RoomCard onClick={() => setView('room')} /></div><div className="section-heading lower"><h3>How ARXYN feels</h3></div><div className="feature-row"><Feature icon={<Radio/>} title="One shared moment" text="A server-authoritative pulse keeps every device aligned."/><Feature icon={<MessageCircle/>} title="The room is alive" text="Chat, react, request, and make the queue yours."/><Feature icon={<SlidersHorizontal/>} title="You stay in control" text="Clear roles make hosting feel effortless."/></div></div>;
}

function RoomCard({ featured, onClick }: { featured?: boolean; onClick: () => void }) { return <button className={'room-card ' + (featured ? 'featured' : '')} onClick={onClick}><div className="card-image" style={{ background: featured ? artwork[0] : artwork[2] }}><span className="live-pill"><i/> {featured ? 'LIVE NOW' : 'PAUSED'}</span><span className="card-menu"><MoreHorizontal size={17}/></span></div><div className="room-card-body"><div><h4>{featured ? 'Saturday night radio' : 'Deep focus'}</h4><p>{featured ? 'Rahul’s room' : 'Your private room'}</p></div><div className="connected"><Users size={14}/>{featured ? '12 listening' : '0 listening'}</div></div></button> }
function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="feature"><div className="feature-icon">{icon}</div><div><strong>{title}</strong><p>{text}</p></div></div> }

function RoomView({ playing, setPlaying, copyCode, copied, notify, openSources, chat, chatText, setChatText, sendMessage }: any) { return <div className="room-content fade-in"><div className="room-header"><div><div className="breadcrumb"><button onClick={() => location.reload()}>Overview</button><span>/</span>Saturday night radio</div><h1>Saturday night radio</h1><div className="room-meta"><span className="live-pill"><i/> LIVE</span><span><Users size={14}/> 12 listening</span><span className="code"><LockKeyhole size={13}/> A7K92X <button onClick={copyCode} aria-label="Copy room code">{copied ? <Check size={13}/> : <Copy size={13}/>}</button></span></div></div><button className="share-button" onClick={() => notify('Invite link copied')}><Share2 size={16}/> Share room</button></div><div className="room-layout"><section className="player-panel"><div className="player-art" style={{ background: artwork[0] }}><div className="art-overlay"><span>NOW PLAYING</span><button className="art-more"><MoreHorizontal size={18}/></button></div></div><div className="track-info"><div><p className="eyebrow">SATURDAY NIGHT RADIO · 01</p><h2>Electric Feel</h2><p className="muted">MGMT</p></div><button className="like-button">♡</button></div><div className="progress"><div className="progress-bar"><span/></div><div><span>2:17</span><span>3:49</span></div></div><div className="player-controls"><button aria-label="Previous"><SkipBack size={19}/></button><button className="play-button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button aria-label="Next"><SkipForward size={19}/></button></div><div className="player-footer"><span><span className="status-dot"/> Synchronized</span><button onClick={openSources}>Add audio source</button></div></section><QueuePanel notify={notify} openSources={openSources}/><ChatPanel chat={chat} chatText={chatText} setChatText={setChatText} sendMessage={sendMessage}/></div><div className="room-tabs"><button className="active"><Music2 size={17}/>Music</button><button><MessageCircle size={17}/>Chat <b>4</b></button><button><Users size={17}/>Members <b>12</b></button></div></div> }
function QueuePanel({ notify, openSources }: { notify: (s: string) => void; openSources: () => void }) { return <section className="queue-panel"><div className="panel-heading"><div><p className="eyebrow">THE QUEUE</p><h3>Up next <span>3 songs</span></h3></div><button className="dots"><MoreHorizontal size={18}/></button></div><div className="queue-list">{queue.map((song, i) => <div className="queue-item" key={song.title}><span className="queue-number">{String(i + 1).padStart(2, '0')}</span><div className="queue-thumb" style={{ background: song.img }}/><div className="queue-song"><strong>{song.title}</strong><span>{song.artist}</span><small>ARXYN Library · by {song.by}</small></div><div className="votes"><button onClick={() => notify('Vote added')} aria-label={`Vote for ${song.title}`}>↑</button><span>{song.votes}</span></div></div>)}</div><button className="add-queue" onClick={openSources}><Plus size={16}/> Add a song or audio file</button><div className="controller-box"><div className="controller-avatar">M</div><div><small>CURRENT CONTROLLER</small><strong>Maya Chen</strong></div><span className="controller-live">ACTIVE</span></div></section> }
function ChatPanel({ chat, chatText, setChatText, sendMessage }: any) { return <section className="chat-panel"><div className="panel-heading"><div><p className="eyebrow">THE ROOM</p><h3>Live chat <span>12 online</span></h3></div><button className="dots"><MoreHorizontal size={18}/></button></div><div className="chat-list">{chat.map((message: any, i: number) => <div className={message.system ? 'chat-message system' : 'chat-message'} key={i}>{message.system ? <><Radio size={14}/><span>{message.text}</span></> : <><div className="avatar message-avatar" style={{ background: message.color }}>{message.name[0]}</div><div><div className="message-top"><strong>{message.name}</strong><small>{message.time}</small></div><p>{message.text}</p></div></>}</div>)}</div><div className="chat-input"><input value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Say something..." aria-label="Chat message"/><button onClick={sendMessage} aria-label="Send message"><Send size={16}/></button></div></section> }

function RoomsView({ setView, setModal }: { setView: (v: View) => void; setModal: (m: Modal) => void }) { return <div className="content fade-in"><div className="page-title"><div><p className="eyebrow">YOUR LIBRARY</p><h1>My rooms</h1><p className="muted">Spaces you host and moments you return to.</p></div><button className="primary-button" onClick={() => setModal('create')}><Plus size={18}/>Create room</button></div><div className="room-list"><RoomCard featured onClick={() => setView('room')}/><RoomCard onClick={() => setView('room')}/><button className="new-room-tile" onClick={() => setModal('create')}><Plus size={22}/><span>Start a new room</span></button></div></div> }
function AnalyticsView() { return <div className="content fade-in"><div className="page-title"><div><p className="eyebrow">SATURDAY NIGHT RADIO</p><h1>Room health</h1><p className="muted">Measured signals from this session.</p></div><span className="health-badge"><i/> Excellent</span></div><div className="metric-grid"><Metric label="Connected devices" value="12" detail="of 50 capacity"/><Metric label="Session duration" value="01:42" detail="since 20:14 today"/><Metric label="Songs played" value="18" detail="3 requests pending"/><Metric label="Sync status" value="—" detail="Waiting for device data" muted/></div><div className="empty-analytics"><BarChart3 size={30}/><h3>More signals appear as devices report in</h3><p>Latency, jitter, drift, and buffer health will show here when measured by connected clients.</p></div></div> }
function Metric({ label, value, detail, muted }: { label: string; value: string; detail: string; muted?: boolean }) { return <div className="metric"><span>{label}</span><strong className={muted ? 'muted-value' : ''}>{value}</strong><small>{detail}</small></div> }

function CreateModal({ roomName, setRoomName, close, create }: any) { const [capacity, setCapacity] = useState('50'); return <div className="modal-backdrop" onMouseDown={close}><div className="modal" onMouseDown={e => e.stopPropagation()}><button className="close-modal" onClick={close}><X size={19}/></button><p className="eyebrow">NEW ROOM</p><h2>Create your wave</h2><p className="muted">Set the room up your way. You can change these later.</p><label>Room name<input autoFocus value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="e.g. Saturday night radio"/></label><label>Maximum devices<div className="capacity-grid">{['5','10','25','50','100','250','500'].map(item => <button type="button" className={capacity === item ? 'selected' : ''} onClick={() => setCapacity(item)} key={item}>{item}</button>)}</div></label><label>Join policy<select><option>Anyone with code</option><option>Approval required</option></select></label><div className="setting-row"><div><strong>Song requests</strong><small>Let listeners add to the queue</small></div><div className="toggle on"><i/></div></div><button className="primary-button full" onClick={create}>Create room <ArrowUpRight size={17}/></button></div></div> }
function JoinModal({ close, join }: any) { return <div className="modal-backdrop" onMouseDown={close}><div className="modal compact" onMouseDown={e => e.stopPropagation()}><button className="close-modal" onClick={close}><X size={19}/></button><p className="eyebrow">JOIN A ROOM</p><h2>Find your wave</h2><p className="muted">Enter the 6-character room code your host shared.</p><div className="code-inputs"><input maxLength={1}/><input maxLength={1}/><input maxLength={1}/><input maxLength={1}/><input maxLength={1}/><input maxLength={1}/></div><button className="primary-button full" onClick={join}>Join room <ArrowUpRight size={17}/></button><div className="or"><span>or</span></div><button className="secondary-button full" onClick={join}><Search size={16}/> Scan QR code</button></div></div> }

function SourceModal({ close, googleConnected, connectGoogle, notify }: { close: () => void; googleConnected: boolean; connectGoogle: () => void; notify: (message: string) => void }) {
  const [search, setSearch] = useState('');
  const [activeSource, setActiveSource] = useState('All sources');
  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      notify('Only audio files can be added to ARXYN');
      return;
    }
    close();
    notify(`${file.name} added to the queue`);
  };
  return <div className="modal-backdrop" onMouseDown={close}><div className="modal source-modal" onMouseDown={e => e.stopPropagation()}><button className="close-modal" onClick={close}><X size={19}/></button><p className="eyebrow">ADD MUSIC</p><h2>Choose audio source</h2><p className="muted">Search one provider at a time. Video sources remain audio-only in the room.</p><div className="music-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search music" aria-label="Search music"/><span>⌘ K</span></div><div className="source-filters">{['All sources', 'YouTube', 'YouTube Music', 'Amazon Music', 'ARXYN Library'].map(source => <button className={activeSource === source ? 'active' : ''} onClick={() => setActiveSource(source)} key={source}>{source}</button>)}</div><div className="source-list"><button className="source-option" onClick={() => notify('YouTube audio-only connection needs your YouTube API setup')}><span className="source-icon youtube"><Youtube size={20}/></span><span><strong>YouTube</strong><small>Find supported audio sources from YouTube · audio only</small></span><span className="source-status">{googleConnected ? 'Connected' : 'Connect'} <ArrowUpRight size={16}/></span></button><button className="source-option" onClick={() => notify('YouTube Music connection needs your Google API setup')}><span className="source-icon yt-music"><Music2 size={20}/></span><span><strong>YouTube Music</strong><small>Search supported music and playlists</small></span><span className="source-status">{googleConnected ? 'Connected' : 'Connect'} <ArrowUpRight size={16}/></span></button><button className="source-option" onClick={() => notify('Amazon Music integration requires provider authorization')}><span className="source-icon amazon"><Headphones size={20}/></span><span><strong>Amazon Music</strong><small>Connect your supported music account</small></span><span className="source-status">Connect <ArrowUpRight size={16}/></span></button><label className="source-option file-option"><span className="source-icon local"><FolderOpen size={20}/></span><span><strong>Device files</strong><small>Play MP3, WAV, AAC/M4A, OGG, or FLAC files</small></span><input type="file" accept="audio/*" onChange={chooseFile}/><span className="source-status">Open <ArrowUpRight size={16}/></span></label><button className="source-option" onClick={() => notify('ARXYN Library will be available after Supabase storage is configured')}><span className="source-icon library"><Radio size={20}/></span><span><strong>ARXYN Library</strong><small>Authorized audio shared with this room</small></span><span className="source-status">Browse <ArrowUpRight size={16}/></span></button></div><div className="account-connect"><div><small>CONNECTED SERVICES</small><strong>Google <span className="connected-check">✓ Connected</span> · YouTube / YouTube Music <span className="connected-check">{googleConnected ? '✓ Connected' : 'Not connected'}</span> · Amazon Music <span className="service-link">Connect</span></strong></div><button className="secondary-button" onClick={connectGoogle}>{googleConnected ? 'Connect another' : 'Connect Google'}</button></div><div className="source-note"><Link2 size={14}/> Protected streams cannot be extracted, downloaded, or redistributed. Use an official provider integration or a selected audio file.</div></div></div>
}

export default App;

const rootHost = window as Window & { __arxynRoot?: ReturnType<typeof createRoot> };
rootHost.__arxynRoot ??= createRoot(document.getElementById('root')!);
rootHost.__arxynRoot.render(<App />);
